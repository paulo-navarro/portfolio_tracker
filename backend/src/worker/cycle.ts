/**
 * Uma coleta. Primeiro conversa com as corretoras e junta tudo em memória;
 * depois grava a coleta inteira numa transação curta (ou entra toda, ou nada).
 *
 * Cada coleta é completa: conta que falhou, ou que já coletou um dia e hoje
 * não coleta (bloqueada, trocando de chave), entra com o último saldo bom e
 * `account_sync.ok = false`. O total não despenca, e qualquer coleta antiga
 * pode ser apagada sem perder o último saldo de ninguém.
 *
 * O banco guarda a coleta mais recente e a última de cada dia (fuso de São
 * Paulo): ao gravar, as outras do mesmo dia são apagadas.
 */
import { config } from '../config.ts'
import type { Db } from '../db/pool.ts'
import { openCredentials } from '../sealing.ts'
import { mapLimit, type WorkerDeps } from './deps.ts'
import { errorMessage } from './exchanges/index.ts'
import type { Holding, Kind } from './exchanges/types.ts'
import type { Quote } from './market.ts'

const ATH_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface AccountRow {
  id: string
  kind: Kind | 'manual'
  label: string
  status: string
  sealed_credentials: Uint8Array | null
}

interface Synced {
  accountId: string
  ok: boolean
  error: string | null
  holdings: Holding[]
}

export interface CycleResult {
  runId: string
  accounts: number
  failed: number
  tickers: number
  unpriced: string[]
}

/** Uma coleta completa. Devolve null se não há conta nenhuma para coletar. */
export async function collectOnce(d: WorkerDeps): Promise<CycleResult | null> {
  const startedAt = d.now()

  // Manuais, e toda conta de corretora que já coletou alguma vez (tem uid).
  // Pendente nova ainda não tem saldo nenhum para carregar.
  const { rows: accounts } = await d.db.query<AccountRow>(
    `select id, kind, label, status, sealed_credentials
       from account
      where removed_at is null and (kind = 'manual' or exchange_uid is not null)
      order by created_at`,
  )
  if (accounts.length === 0) return null

  const synced = await mapLimit(accounts, config.collectConcurrency, (a) => syncAccount(d, a))

  const tickers = [...new Set(synced.flatMap((s) => s.holdings.map((h) => h.ticker)))].sort()
  const { quotes, usdBrl } = await d.market.fetchQuotes(tickers)
  const aths = await refreshAths(d, tickers)

  const runId = await d.tx(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into run (started_at, finished_at, status, usd_brl) values ($1, $2, 'ok', $3) returning id`,
      [startedAt, d.now(), usdBrl],
    )
    const id = rows[0].id
    await writeSynced(db, id, synced)
    await writeQuotes(db, id, quotes)
    await writeAths(db, aths, d.now())
    await prune(db, id)
    return id
  })

  const priced = new Set(quotes.map((q) => q.ticker))
  return {
    runId,
    accounts: synced.length,
    failed: synced.filter((s) => !s.ok).length,
    tickers: tickers.length,
    unpriced: tickers.filter((t) => !priced.has(t)),
  }
}

async function syncAccount(d: WorkerDeps, a: AccountRow): Promise<Synced> {
  if (a.kind === 'manual') {
    const { rows } = await d.db.query<{ ticker: string; amount: string }>(
      `select ticker, amount from manual_holding where account_id = $1 and amount > 0`,
      [a.id],
    )
    return { accountId: a.id, ok: true, error: null, holdings: rows.map((r) => ({ ticker: r.ticker, wallet: 'manual', amount: r.amount })) }
  }

  const failed = async (error: string): Promise<Synced> => ({
    accountId: a.id,
    ok: false,
    error,
    holdings: await lastGood(d.db, a.id),
  })

  if (a.status !== 'active') return failed(`não coletada: conta ${a.status}`)
  if (!a.sealed_credentials) return failed('conta ativa sem chave')

  try {
    const creds = await openCredentials(a.sealed_credentials, d.keys)
    const exchange = d.exchanges(a.kind, creds)

    // Revalida antes de ler: se a chave ganhou poder na corretora, bloqueia e
    // apaga o ciphertext. O saldo continua, desatualizado, até trocar a chave.
    const perm = await exchange.checkPermissions()
    if (!perm.readOnly) {
      const reason = `bloqueada: ${perm.reason ?? 'a chave passou a poder mais que ler.'}`
      await d.db.query(
        `update account
            set status = 'blocked', status_reason = $2, sealed_credentials = null,
                permissions = $3, ip_restricted = $4, checked_at = now()
          where id = $1`,
        [a.id, reason, JSON.stringify(perm.raw), perm.ipRestricted],
      )
      d.log(`account ${a.label} (${a.kind}) ${reason}`)
      return failed(reason)
    }

    const holdings = await exchange.fetchBalances()
    await d.db.query(`update account set permissions = $2, ip_restricted = $3, checked_at = now() where id = $1`, [
      a.id,
      JSON.stringify(perm.raw),
      perm.ipRestricted,
    ])
    return { accountId: a.id, ok: true, error: null, holdings }
  } catch (err) {
    // Chave revogada, rede, corretora fora do ar: a conta fica desatualizada,
    // o status não muda. Quem decide trocar a chave é a pessoa.
    d.log(`account ${a.label} (${a.kind}) failed: ${errorMessage(err)}`)
    return failed(errorMessage(err))
  }
}

/** Os saldos da conta na coleta mais recente (que já podem ser uma cópia). */
async function lastGood(db: Db, accountId: string): Promise<Holding[]> {
  const { rows } = await db.query<Holding>(
    `select b.ticker, b.wallet, b.amount
       from balance b
       join v_latest_run l on l.id = b.run_id
      where b.account_id = $1`,
    [accountId],
  )
  return rows
}

interface AthUpdate {
  ticker: string
  athUsd: string | null
}

/** ATH dos tickers sem ATH ou com ATH de mais de 24h. Falhar só adia. */
async function refreshAths(d: WorkerDeps, tickers: string[]): Promise<AthUpdate[]> {
  const { rows } = await d.db.query<{ ticker: string; ath_usd: string | null; checked: Date | null }>(
    `select t as ticker, a.ath_usd, a.ath_checked_at as checked
       from unnest($1::text[]) t
       left join asset a on a.ticker = t`,
    [tickers],
  )
  const now = d.now().getTime()
  const out: AthUpdate[] = []
  for (const r of rows) {
    if (r.checked && now - r.checked.getTime() < ATH_MAX_AGE_MS) continue
    let ath: string | null = null
    try {
      ath = await d.market.fetchAth(r.ticker)
    } catch (err) {
      d.log(`ath ${r.ticker} failed: ${errorMessage(err)}`)
    }
    // ATH não cai. Se veio menor, o símbolo provavelmente resolveu para o
    // token errado: fica o guardado.
    if (ath && r.ath_usd && Number(ath) < Number(r.ath_usd)) {
      d.log(`ath ${r.ticker}: cryptoprices says ${ath}, keeping ${r.ath_usd}`)
    }
    out.push({ ticker: r.ticker, athUsd: ath })
  }
  return out
}

async function writeSynced(db: Db, runId: string, synced: Synced[]) {
  for (const s of synced) {
    await db.query(`insert into account_sync (run_id, account_id, ok, error) values ($1, $2, $3, $4)`, [
      runId,
      s.accountId,
      s.ok,
      s.error,
    ])
    // Mesmo ticker e carteira mais de uma vez (free + locked, duas ordens de
    // staking): o Postgres soma, exato.
    for (const h of s.holdings) {
      await db.query(
        `insert into balance (run_id, account_id, ticker, wallet, amount) values ($1, $2, $3, $4, $5)
         on conflict (run_id, account_id, ticker, wallet) do update set amount = balance.amount + excluded.amount`,
        [runId, s.accountId, h.ticker, h.wallet, h.amount],
      )
    }
  }
}

async function writeQuotes(db: Db, runId: string, quotes: Quote[]) {
  for (const q of quotes) {
    await db.query(
      `insert into quote (run_id, ticker, price_usd, chg_24h, chg_7d, source) values ($1, $2, $3, $4, $5, $6)`,
      [runId, q.ticker, q.priceUsd, q.chg24h, q.chg7d, q.source],
    )
  }
}

async function writeAths(db: Db, aths: AthUpdate[], checkedAt: Date) {
  for (const a of aths) {
    // Sem resposta, só marca a hora: não pergunta de novo por 24h.
    await db.query(
      `insert into asset (ticker, ath_usd, ath_checked_at) values ($1, $2, $3)
       on conflict (ticker) do update
         set ath_usd = greatest(asset.ath_usd, excluded.ath_usd),
             ath_checked_at = excluded.ath_checked_at`,
      [a.ticker, a.athUsd, checkedAt],
    )
  }
}

/**
 * Fica a coleta nova e a última de cada dia anterior. Apaga as outras do mesmo
 * dia (em São Paulo) e qualquer coleta que não terminou bem. O cascade leva
 * account_sync, balance e quote junto.
 */
async function prune(db: Db, runId: string) {
  await db.query(
    `delete from run
      where id <> $1
        and (status <> 'ok'
             or (finished_at at time zone 'America/Sao_Paulo')::date
                = (select (finished_at at time zone 'America/Sao_Paulo')::date from run where id = $1))`,
    [runId],
  )
}
