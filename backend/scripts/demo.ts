/**
 * Dados de demonstração no dev: a planilha de 21/09/2026 como contas manuais,
 * no portfólio "Planilha (demo)" do usuário de dev.
 *
 *   make demo        cria (ou recria) e pede uma coleta
 *   make demo-clear  apaga tudo que o demo criou
 *
 * O worker coleta as posições manuais ao vivo, então preço, 24h, 7d e ATH são
 * os de agora. O histórico dos dias anteriores sai dos fechamentos diários
 * reais da Binance (um retrato por dia, como a coleta grava).
 */
import ccxt from 'ccxt'
import { sheet } from './fixture.ts'
import { connect, env } from './lib.ts'

const NAME = 'Planilha (demo)'
const DAYS = 90
const CYCLE_LOCK = 7_331_001
const clear = process.argv.includes('--clear')

const db = await connect(env.ownerUrl)
// Nada de coleta de verdade no meio: ela veria metade do demo.
await db.query('select pg_advisory_lock($1)', [CYCLE_LOCK])

async function removeDemo() {
  const accounts = `select a.id from account a join portfolio p on p.id = a.portfolio_id where p.name = $1`
  await db.query(`delete from account_sync where account_id in (${accounts})`, [NAME])
  await db.query(`delete from account where id in (${accounts})`, [NAME])
  await db.query(`delete from portfolio where name = $1`, [NAME])
  // Coleta que só tinha o demo ficou vazia.
  await db.query(`delete from run where id not in (select run_id from account_sync)`)
}

try {
  await db.query('begin')
  await removeDemo()

  if (!clear) {
    const user = await db.query<{ id: string }>(
      `insert into app_user (google_sub, email, name) values ('dev:local', 'dev@localhost', 'Dev')
       on conflict (google_sub) do update set name = app_user.name returning id`,
    )
    const userId = user.rows[0].id
    const p = await db.query<{ id: string }>(`insert into portfolio (name, invested_brl) values ($1, $2) returning id`, [NAME, sheet.investedBrl])
    const portfolioId = p.rows[0].id
    await db.query(`insert into portfolio_member (portfolio_id, user_id, role) values ($1, $2, 'owner')`, [portfolioId, userId])

    // As três contas da planilha, como manuais (o demo não tem chave de corretora).
    const labels: Record<string, string> = { binance: 'Binance (demo)', okx: 'OKX (demo)', manual: 'Fora de corretora' }
    const accountIds: Record<string, string> = {}
    for (const key of Object.keys(labels)) {
      const { rows } = await db.query<{ id: string }>(
        `insert into account (portfolio_id, kind, label, status, created_by) values ($1, 'manual', $2, 'active', $3) returning id`,
        [portfolioId, labels[key], userId],
      )
      accountIds[key] = rows[0].id
    }
    const holdings = new Map<string, { account: string; ticker: string; amount: number }>()
    for (const b of sheet.balances) {
      if (Number(b.amount) <= 0) continue
      const k = `${b.account}:${b.ticker}`
      const prev = holdings.get(k)
      holdings.set(k, { account: b.account, ticker: b.ticker, amount: (prev?.amount ?? 0) + Number(b.amount) })
    }
    for (const h of holdings.values()) {
      const amount = sheet.balances.filter((b) => b.account === h.account && b.ticker === h.ticker).map((b) => b.amount)
      await db.query(`insert into manual_holding (account_id, ticker, amount) values ($1, $2, $3)`, [
        accountIds[h.account],
        h.ticker,
        amount.length === 1 ? amount[0] : String(h.amount),
      ])
    }

    // Histórico: fechamento diário real de cada ativo e do USDT/BRL.
    const binance = new ccxt.binance({ enableRateLimit: true })
    const tickers = [...new Set(sheet.quotes.map((q) => q.ticker))]
    const closes = new Map<string, Map<string, number>>() // ticker → dia (UTC) → fechamento
    async function klines(symbol: string) {
      const rows = (await binance.publicGetKlines({ symbol, interval: '1d', limit: DAYS + 8 })) as string[][]
      return new Map(rows.map((r) => [new Date(Number(r[0])).toISOString().slice(0, 10), Number(r[4])]))
    }
    for (const t of tickers) closes.set(t, t === 'USDT' ? new Map() : await klines(`${t}USDT`))
    const fx = await klines('USDTBRL')

    const today = new Date().toISOString().slice(0, 10)
    const days = [...fx.keys()].filter((d) => d < today).sort().slice(-DAYS)
    const allDays = [...fx.keys()].sort()
    for (const day of days) {
      // Fim do dia em São Paulo: o retrato que a coleta teria guardado.
      const finished = new Date(`${day}T23:50:00-03:00`)
      const run = await db.query<{ id: string }>(
        `insert into run (started_at, finished_at, status, usd_brl) values ($1, $1, 'ok', $2) returning id`,
        [finished, fx.get(day)],
      )
      const runId = run.rows[0].id
      for (const id of Object.values(accountIds)) await db.query(`insert into account_sync (run_id, account_id, ok) values ($1, $2, true)`, [runId, id])
      for (const h of holdings.values()) {
        await db.query(
          `insert into balance (run_id, account_id, ticker, wallet, amount) values ($1, $2, $3, 'manual', $4)
           on conflict (run_id, account_id, ticker, wallet) do update set amount = balance.amount + excluded.amount`,
          [runId, accountIds[h.account], h.ticker, String(h.amount)],
        )
      }
      const i = allDays.indexOf(day)
      for (const t of tickers) {
        if (t === 'USDT') {
          await db.query(`insert into quote values ($1, 'USDT', 1, 0, 0, 'stable')`, [runId])
          continue
        }
        const c = closes.get(t)!
        const now = c.get(day)
        if (now === undefined) continue
        const d1 = c.get(allDays[i - 1])
        const d7 = c.get(allDays[i - 7])
        await db.query(`insert into quote values ($1, $2, $3, $4, $5, 'binance')`, [
          runId,
          t,
          now,
          d1 ? (now / d1 - 1) * 100 : null,
          d7 ? (now / d7 - 1) * 100 : null,
        ])
      }
    }
    await db.query('commit')
    console.log(`demo: portfólio "${NAME}" com ${holdings.size} posições e ${days.length} dias de histórico.`)
    console.log('entre como dev em http://localhost:5175 (a coleta de agora roda em segundos).')
  } else {
    await db.query('commit')
    console.log('demo apagado.')
  }
} catch (err) {
  await db.query('rollback').catch(() => {})
  throw err
} finally {
  await db.query('select pg_advisory_unlock($1)', [CYCLE_LOCK])
  // Coleta de agora, com preço ao vivo, para o demo não ficar só no passado.
  if (!clear) await db.query('notify collect_now')
  await db.end()
}
