/**
 * Worker. Coleta a cada COLLECT_INTERVAL_MIN minutos e sempre que chega um
 * NOTIFY: `account_pending` (a api cadastrou uma chave) ou `collect_now`
 * (`make collect`). Um ciclo por vez, garantido por advisory lock no banco.
 */
import pg from 'pg'
import { assertConfig, config } from '../config.ts'
import { pool, withTransaction } from '../db/pool.ts'
import { loadSealingKeys, type SealingKeys } from '../sealing.ts'
import { collectOnce } from './cycle.ts'
import type { WorkerDeps } from './deps.ts'
import { errorMessage } from './exchanges/index.ts'
import { liveExchanges } from './exchanges/index.ts'
import { liveMarket } from './market.ts'
import { syncFiat } from './fiat.ts'
import { validatePending } from './validate.ts'

const HEARTBEAT_MS = 60_000
// Número qualquer, fixo: identifica o lock da coleta no pg_advisory_lock.
const CYCLE_LOCK = 7_331_001

const log = (msg: string) => console.log(`[worker] ${msg}`)

assertConfig()

let keys: SealingKeys
try {
  keys = await loadSealingKeys(config.sealingPrivateKeyFile, config.sealingPublicKeyFile)
  log('sealing key pair ok')
} catch (err) {
  // Sem a chave o worker não abre nenhuma credencial: não adianta subir.
  console.error(`[worker] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

const deps: WorkerDeps = {
  db: pool,
  tx: withTransaction,
  exchanges: liveExchanges,
  market: liveMarket(),
  keys,
  now: () => new Date(),
  log,
}

const startedAt = new Date()

async function heartbeat() {
  try {
    await pool.query(
      `insert into worker_status (id, started_at, seen_at)
       values (true, $1, now())
       on conflict (id) do update set started_at = excluded.started_at, seen_at = now()`,
      [startedAt],
    )
  } catch (err) {
    // Banco fora do ar não derruba o worker: tenta de novo no próximo minuto.
    console.error(`[worker] heartbeat failed: ${errorMessage(err)}`)
  }
}

// ── Ciclo ────────────────────────────────────────────
// Pedido que chega com um ciclo rodando não se perde: marca `again` e roda
// mais uma vez no fim. Dez NOTIFY seguidos viram no máximo dois ciclos.
let running = false
let again = false

async function cycle(reason: string) {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      await lockedCycle(reason)
      reason = 'requested while running'
    } while (again)
  } catch (err) {
    // Banco fora do ar ao pegar a conexão. Quem chama não espera a promessa:
    // sem este catch o Node derrubaria o worker. O próximo timer tenta de novo.
    log(`cycle could not start: ${errorMessage(err)}`)
  } finally {
    running = false
  }
  // Depois de cada coleta (ela pode ter ativado uma conta nova).
  void fiat()
}

async function lockedCycle(reason: string) {
  const client = await pool.connect()
  try {
    const { rows } = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [CYCLE_LOCK])
    if (!rows[0].ok) {
      log('another cycle holds the lock, skipping')
      return
    }
    try {
      log(`cycle (${reason})`)
      await validatePending(deps)
      const result = await collectOnce(deps)
      if (result) {
        const unpriced = result.unpriced.length ? `, no price: ${result.unpriced.join(' ')}` : ''
        log(`run ${result.runId}: ${result.accounts} accounts (${result.failed} failed), ${result.tickers} tickers${unpriced}`)
      } else {
        log('no accounts to collect')
      }
      await pool.query(`update worker_status set last_cycle_at = now(), last_run_id = coalesce($1, last_run_id), last_error = null`, [
        result?.runId ?? null,
      ])
    } catch (err) {
      log(`cycle failed: ${errorMessage(err)}`)
      await pool.query(`update worker_status set last_cycle_at = now(), last_error = $1`, [errorMessage(err)]).catch(() => {})
    } finally {
      await client.query('select pg_advisory_unlock($1)', [CYCLE_LOCK])
    }
  } finally {
    client.release()
  }
}

// ── Histórico de reais ───────────────────────────────
// Fora do lock da coleta, em segundo plano: a primeira busca de uma conta leva
// uns 2 minutos (a rota da Binance é lenta de propósito) e a coleta de 15 em
// 15 minutos não espera por ela. Uma de cada vez.
let fiatRunning = false

async function fiat() {
  if (fiatRunning) return
  fiatRunning = true
  try {
    await syncFiat(deps)
  } catch (err) {
    log(`fiat sync failed: ${errorMessage(err)}`)
  } finally {
    fiatRunning = false
  }
}

// ── NOTIFY ───────────────────────────────────────────
// Conexão própria, fora do pool: LISTEN vale por conexão. Caiu, reconecta.
let listener: pg.Client | null = null
let stopping = false

async function listen() {
  if (stopping) return
  const client = new pg.Client({ connectionString: config.databaseUrl })
  listener = client
  client.on('notification', (msg) => void cycle(msg.channel))
  client.on('error', (err) => {
    log(`listen connection lost: ${err.message}; reconnecting in 5s`)
    client.end().catch(() => {})
    setTimeout(() => void listen().catch(() => {}), 5_000)
  })
  try {
    await client.connect()
    await client.query('listen account_pending')
    await client.query('listen collect_now')
  } catch (err) {
    log(`listen failed: ${errorMessage(err)}; retrying in 5s`)
    client.end().catch(() => {})
    setTimeout(() => void listen().catch(() => {}), 5_000)
  }
}

await heartbeat()
await listen()
const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS)
const cycleTimer = setInterval(() => void cycle('timer'), config.collectIntervalMin * 60_000)
void cycle('boot')

// Desligar rápido: a conexão do LISTEN segurava o processo, e o Docker (ou o
// tsx watch) esperava até matar. Uma coleta pela metade não grava nada.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    stopping = true
    clearInterval(heartbeatTimer)
    clearInterval(cycleTimer)
    setTimeout(() => process.exit(0), 2_000).unref()
    await Promise.allSettled([listener?.end(), pool.end()])
    process.exit(0)
  })
}
