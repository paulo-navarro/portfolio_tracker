/**
 * Fase 2 — a coleta grava o que deve, e só o que deve?
 *
 *   make smoke
 *
 * Coletas inteiras com corretoras e mercado falsos e um relógio parado, como
 * app_worker, numa transação que volta atrás.
 */
import { collectOnce } from '../src/worker/cycle.ts'
import { createPortfolio, createUser } from './fixture.ts'
import { FakeExchanges, FakeMarket, fakeDeps, insertAccount, throwawayKeys } from './fakes.ts'
import { assert, check, connect, env, finish, inRollback, near } from './lib.ts'

console.log('cycle smoke\n')

const db = await connect(env.ownerUrl)
const keys = await throwawayKeys()

await inRollback(db, async () => {
  // Coletas e ATHs de verdade que existam no dev (worker, make demo) não
  // entram na conta. Tudo volta no rollback.
  await db.query('delete from run')
  await db.query('delete from asset')
  // A coleta é global: contas que já existem (make demo, seal-account) sairiam
  // junto. Removidas aqui, dentro da mesma transação que volta atrás.
  await db.query('update account set removed_at = now(), sealed_credentials = null where removed_at is null')

  const userId = await createUser(db, `cycle-${crypto.randomUUID()}`)
  const portfolioId = await createPortfolio(db, userId, 'Cycle', null)
  const binanceId = await insertAccount(db, { portfolioId, userId, kind: 'binance', apiKey: 'bin', keys, status: 'active', uid: 'b1' })
  const okxId = await insertAccount(db, { portfolioId, userId, kind: 'okx', apiKey: 'okx', keys, status: 'active', uid: 'o1' })
  const pendingId = await insertAccount(db, { portfolioId, userId, kind: 'binance', apiKey: 'new', keys })
  const { rows: m } = await db.query<{ id: string }>(
    `insert into account (portfolio_id, kind, label, status, created_by) values ($1, 'manual', 'Ledger', 'active', $2) returning id`,
    [portfolioId, userId],
  )
  const manualId = m[0].id
  await db.query(`insert into manual_holding (account_id, ticker, amount) values ($1, 'BTC', '0.4'), ($1, 'ETH', '0')`, [manualId])
  // ATH guardado maior do que o cryptoprices vai responder.
  await db.query(`insert into asset (ticker, ath_usd, ath_checked_at) values ('SOL', '300', '2026-09-01')`)

  const ex = new FakeExchanges()
  ex.behaviors.set('bin', {
    balances: [
      { ticker: 'ETH', wallet: 'spot', amount: '0.3' },
      { ticker: 'ETH', wallet: 'spot', amount: '0.2' },
      { ticker: 'SOL', wallet: 'earn_locked', amount: '1.5' },
      { ticker: 'NOPRICE', wallet: 'spot', amount: '5' },
    ],
  })
  ex.behaviors.set('okx', { balances: [{ ticker: 'USDT', wallet: 'funding', amount: '0.16' }, { ticker: 'APT', wallet: 'staking', amount: '60' }] })
  const market = new FakeMarket()
  const clock = { now: new Date('2026-09-20T23:50:00-03:00') }
  const d = fakeDeps(db, keys, ex, market, clock)
  await db.query('set local role app_worker')

  const balances = async (runId: string) =>
    (
      await db.query<{ k: string }>(
        `select a.label || ':' || b.wallet || ':' || b.ticker || '=' || b.amount::text as k
           from balance b join account a on a.id = b.account_id where b.run_id = $1`,
        [runId],
      )
    ).rows
      .map((r) => r.k)
      .sort()

  const first = await collectOnce(d)

  await check('coleta completa: corretoras, manual, cotações e câmbio', async () => {
    assert(first, 'não coletou')
    const got = await balances(first.runId)
    const want = [
      'Ledger:manual:BTC=0.4', // o ETH 0 do manual não virou linha
      'bin:earn_locked:SOL=1.5',
      'bin:spot:ETH=0.5', // 0.3 + 0.2, somado pelo Postgres
      'bin:spot:NOPRICE=5',
      'okx:funding:USDT=0.16',
      'okx:staking:APT=60',
    ]
    assert(got.join() === want.join(), `\n    veio   ${got.join(' ')}\n    queria ${want.join(' ')}`)
    const { rows } = await db.query(`select usd_brl from run where id = $1`, [first.runId])
    assert(rows[0].usd_brl === '5.1059', rows[0].usd_brl)
    assert(first.unpriced.join() === 'NOPRICE', `sem preço: ${first.unpriced.join()}`)
  })

  await check('conta pendente não é coletada (não tem uid ainda)', async () => {
    const { rowCount } = await db.query(`select 1 from account_sync where account_id = $1`, [pendingId])
    assert(rowCount === 0, 'coletou a pendente')
  })

  await check('ATH: novo entra, ausente só marca a hora, menor não derruba o guardado', async () => {
    const { rows } = await db.query<{ ticker: string; ath: string | null; checked: boolean }>(
      `select ticker, ath_usd::text as ath, ath_checked_at is not null as checked from asset
        where ticker in ('BTC', 'SOL', 'NOPRICE') order by ticker`,
    )
    const got = rows.map((r) => `${r.ticker}=${r.ath}:${r.checked}`).join(' ')
    // SOL: cryptoprices diz 293.31, o guardado é 300. Fica 300.
    assert(got === 'BTC=126080:true NOPRICE=null:true SOL=300:true', got)
  })

  await check('ATH de menos de 24h não é pedido de novo', async () => {
    market.athCalls = []
    clock.now = new Date('2026-09-20T23:55:00-03:00')
    await collectOnce(d)
    assert(market.athCalls.length === 0, `pediu ${market.athCalls.join()}`)
  })

  await check('um retrato por dia: coletas do mesmo dia se substituem', async () => {
    clock.now = new Date('2026-09-21T10:00:00-03:00')
    await collectOnce(d)
    clock.now = new Date('2026-09-21T23:45:00-03:00')
    await collectOnce(d)
    const { rows } = await db.query<{ day: string }>(
      `select (finished_at at time zone 'America/Sao_Paulo')::date::text as day from run order by id`,
    )
    // 20/09: a das 23:55 substituiu a das 23:50. 21/09: a das 23:45 (ainda 21 em SP).
    assert(rows.map((r) => r.day).join() === '2026-09-20,2026-09-21', rows.map((r) => r.day).join())
  })

  await check('conta que falha entra com o último saldo, desatualizada, e o total não cai', async () => {
    const before = (await db.query(`select value_usd from v_portfolio_summary where portfolio_id = $1`, [portfolioId])).rows[0].value_usd
    ex.behaviors.set('okx', { error: 'network' })
    clock.now = new Date('2026-09-22T09:00:00-03:00')
    const run = await collectOnce(d)
    assert(run, 'não coletou')
    const { rows } = await db.query(`select ok, error from account_sync where run_id = $1 and account_id = $2`, [run.runId, okxId])
    assert(rows[0].ok === false && rows[0].error.includes('connection reset'), JSON.stringify(rows[0]))
    const got = await balances(run.runId)
    assert(got.includes('okx:staking:APT=60'), got.join(' '))
    const s = (await db.query(`select value_usd, stale from v_portfolio_summary where portfolio_id = $1`, [portfolioId])).rows[0]
    assert(s.stale === true, 'não marcou desatualizado')
    assert(s.value_usd === before, `total mudou: ${before} → ${s.value_usd}`)
  })

  await check('falhar duas vezes seguidas continua carregando o saldo (a cópia da cópia)', async () => {
    clock.now = new Date('2026-09-23T09:00:00-03:00')
    const run = await collectOnce(d)
    assert(run, 'não coletou')
    assert((await balances(run.runId)).includes('okx:funding:USDT=0.16'), 'perdeu o saldo da okx')
  })

  await check('chave que ganhou poder na corretora: bloqueada, ciphertext apagado, saldo mantido', async () => {
    ex.behaviors.set('bin', { permissions: 'binance-restrictions-trade', balances: [] })
    ex.calls = []
    clock.now = new Date('2026-09-24T09:00:00-03:00')
    const run = await collectOnce(d)
    assert(run, 'não coletou')
    const { rows } = await db.query(`select status, sealed_credentials is null as wiped, status_reason from account where id = $1`, [binanceId])
    assert(rows[0].status === 'blocked' && rows[0].wiped && rows[0].status_reason.includes('negociar'), JSON.stringify(rows[0]))
    assert(!ex.calls.includes('bin:balances'), 'leu saldo com a chave bloqueada')
    assert((await balances(run.runId)).includes('bin:spot:ETH=0.5'), 'o saldo da conta bloqueada sumiu')
  })

  await check('conta bloqueada não é chamada de novo na corretora', async () => {
    ex.calls = []
    clock.now = new Date('2026-09-25T09:00:00-03:00')
    await collectOnce(d)
    assert(!ex.calls.some((c) => c.startsWith('bin:')), ex.calls.join())
  })

  await check('conta removida sai do total', async () => {
    await db.query('reset role')
    await db.query(`update account set removed_at = now(), sealed_credentials = null where id = $1`, [binanceId])
    await db.query('set local role app_worker')
    clock.now = new Date('2026-09-26T09:00:00-03:00')
    const run = await collectOnce(d)
    assert(run, 'não coletou')
    assert(!(await balances(run.runId)).some((b) => b.startsWith('bin:')), 'a conta removida continuou')
    const { rows } = await db.query(`select count(*)::int as n from run`)
    near(rows[0].n, 7, 0, 'um retrato por dia de 20 a 26/09')
  })
})

await db.end()
finish()
