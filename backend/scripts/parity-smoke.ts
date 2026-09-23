/**
 * Fase 1 — as views fazem as contas da planilha?
 *
 *   make smoke
 *
 * Carrega a planilha de 21/09/2026 como uma coleta e lê as views como app_api.
 * Tudo numa transação que volta atrás.
 */
import { createPortfolio, createRun, createUser, loadSheet, sheet } from './fixture.ts'
import { assert, check, connect, env, finish, inRollback, near } from './lib.ts'

console.log('parity smoke\n')

const db = await connect(env.ownerUrl)

// Colunas da planilha → colunas de v_position. Tolerância de ±0.01: a planilha
// mostra 2 casas, e as entradas da fixture já são as menos arredondadas.
const COLUMNS = {
  pctBelowAth: 'pct_below_ath',
  valueUsd: 'value_usd',
  valueAtAthUsd: 'value_at_ath_usd',
  valueAtAthBrl: 'value_at_ath_brl',
  allocationPct: 'allocation_pct',
  priceBrl: 'price_brl',
  valueBrl: 'value_brl',
  chg24h: 'chg_24h',
  chg7d: 'chg_7d',
} as const

await inRollback(db, async () => {
  const { portfolioId, accountIds, runId } = await loadSheet(db)
  await db.query('set local role app_api')

  await check('14 posições, uma por ativo, quantidade da planilha', async () => {
    const { rows } = await db.query<{ ticker: string; qty: string }>(
      `select ticker, qty from v_position where portfolio_id = $1`,
      [portfolioId],
    )
    assert(rows.length === 14, `vieram ${rows.length}`)
    for (const r of rows) {
      const want = sheet.expected.positions[r.ticker].qty as string
      // A coluna B da planilha arredonda, e a soma das linhas 22–30 pode ter
      // mais casas que ela.
      near(r.qty, Number(want), 1e-6, `${r.ticker}.qty`)
    }
  })

  await check('as 13 colunas de cada ativo batem com a planilha (±0.01)', async () => {
    const { rows } = await db.query(`select * from v_position where portfolio_id = $1`, [portfolioId])
    for (const r of rows) {
      const want = sheet.expected.positions[r.ticker]
      for (const [key, col] of Object.entries(COLUMNS)) {
        const w = want[key]
        if (w === null) {
          assert(r[col] === null, `${r.ticker}.${col}: esperava vazio, veio ${r[col]}`)
          continue
        }
        near(r[col], Number(w), 0.01, `${r.ticker}.${col}`)
      }
    }
    return `${rows.length} × ${Object.keys(COLUMNS).length}`
  })

  await check('7d vazio (APT, SUI) vira null, não erro', async () => {
    const { rows } = await db.query(`select ticker from v_position where portfolio_id = $1 and chg_7d is null order by ticker`, [
      portfolioId,
    ])
    assert(rows.map((r) => r.ticker).join() === 'APT,SUI', `vieram ${rows.map((r) => r.ticker).join()}`)
  })

  await check('totais da linha 17 e resultado da K18', async () => {
    const { rows } = await db.query(`select * from v_portfolio_summary where portfolio_id = $1`, [portfolioId])
    const s = rows[0]
    const t = sheet.expected.totals
    near(s.value_usd, t.valueUsd, 0.01, 'F17 value_usd')
    near(s.value_at_ath_usd, t.valueAtAthUsd, 0.01, 'G17 value_at_ath_usd')
    near(s.value_at_ath_brl, t.valueAtAthBrl, 0.02, 'H17 value_at_ath_brl')
    near(s.value_brl, t.valueBrl, 0.01, 'K17 value_brl')
    near(s.result_pct, t.resultPct, 0.01, 'K18 result_pct')
    near(s.invested_brl, Number(sheet.investedBrl), 0, 'J17 invested_brl')
    assert(s.stale === false, 'stale sem conta falhando')
    return `R$ ${Number(s.value_brl).toFixed(2)}, ${Number(s.ath_multiple).toFixed(2)}× no ATH`
  })

  await check('24h: a exata difere da média ponderada da planilha (L17)', async () => {
    const { rows } = await db.query(
      `select s.chg_24h as exact,
              sum(p.value_usd * p.chg_24h) / sum(p.value_usd) as weighted
         from v_portfolio_summary s
         join v_position p using (portfolio_id)
        where s.portfolio_id = $1
        group by s.chg_24h`,
      [portfolioId],
    )
    near(rows[0].weighted, sheet.expected.totals.chg24hWeighted, 0.01, 'média ponderada (planilha)')
    near(rows[0].exact, sheet.expected.totals.chg24hExact, 0.01, 'exata')
    return `exata ${Number(rows[0].exact).toFixed(2)}%, planilha ${Number(rows[0].weighted).toFixed(2)}%`
  })

  await check('onde está: as linhas 22–30', async () => {
    const { rows } = await db.query<{ ticker: string; label: string; wallet: string; amount: string }>(
      `select ticker, label, wallet, amount from v_position_source
        where portfolio_id = $1 and ticker in ('HBAR', 'USDT') order by ticker, amount desc`,
      [portfolioId],
    )
    const got = rows.map((r) => `${r.ticker} ${r.label}/${r.wallet} ${Number(r.amount)}`).join(' · ')
    // O mesmo que a fixture diz, por conta e carteira (as linhas 22–30).
    const labels: Record<string, string> = Object.fromEntries(sheet.accounts.map((a) => [a.key, a.label]))
    const want = sheet.balances
      .filter((b) => ['HBAR', 'USDT'].includes(b.ticker))
      .map((b) => ({ ...b, n: Number(b.amount) }))
      .sort((a, b) => (a.ticker === b.ticker ? b.n - a.n : a.ticker < b.ticker ? -1 : 1))
      .map((b) => `${b.ticker} ${labels[b.account]}/${b.wallet} ${b.n}`)
      .join(' · ')
    assert(got === want, `\n    veio   ${got}\n    queria ${want}`)
  })

  await check('ATH menor que o preço não deixa distância negativa', async () => {
    await db.query('reset role')
    await db.query(`update asset set ath_usd = 1 where ticker = 'ETH'`)
    await db.query('set local role app_api')
    const { rows } = await db.query(`select ath_usd, price_usd, pct_below_ath from v_position where portfolio_id = $1 and ticker = 'ETH'`, [
      portfolioId,
    ])
    assert(Number(rows[0].ath_usd) === Number(rows[0].price_usd), `ath ${rows[0].ath_usd}`)
    near(rows[0].pct_below_ath, 0, 0, 'pct_below_ath')
  })

  await check('conta que falhou marca o total como desatualizado', async () => {
    await db.query('reset role')
    await db.query(`update account_sync set ok = false, error = 'smoke' where run_id = $1 and account_id = $2`, [
      runId,
      accountIds.okx,
    ])
    await db.query('set local role app_api')
    const { rows } = await db.query(`select stale, value_usd from v_portfolio_summary where portfolio_id = $1`, [portfolioId])
    assert(rows[0].stale === true, 'stale continuou false')
    near(rows[0].value_usd, sheet.expected.totals.valueUsd, 0.01, 'o total não despencou')
  })

  await check('histórico: um ponto por dia, e o último é o número grande', async () => {
    await db.query('reset role')
    // Mais duas coletas: uma no dia anterior e uma mais tarde no mesmo dia,
    // com o dobro do BTC. Hoje fica só a mais recente.
    const copy = async (finishedAt: string, btcFactor: number) => {
      const id = await createRun(db, finishedAt, sheet.usdBrl)
      await db.query(`insert into account_sync (run_id, account_id, ok) select $1, account_id, true from account_sync where run_id = $2`, [id, runId])
      await db.query(
        `insert into balance (run_id, account_id, ticker, wallet, amount)
         select $1, account_id, ticker, wallet, case when ticker = 'BTC' then amount * $3 else amount end
           from balance where run_id = $2`,
        [id, runId, btcFactor],
      )
      await db.query(
        `insert into quote (run_id, ticker, price_usd, chg_24h, chg_7d, source)
         select $1, ticker, price_usd, chg_24h, chg_7d, source from quote where run_id = $2`,
        [id, runId],
      )
    }
    await copy('2026-09-20T23:50:00-03:00', 1)
    await copy('2026-09-21T23:45:00-03:00', 2)
    await db.query('set local role app_api')

    const { rows: hist } = await db.query(
      `select day::text, value_usd from v_portfolio_history where portfolio_id = $1 order by day`,
      [portfolioId],
    )
    assert(hist.length === 2, `vieram ${hist.length} pontos: ${hist.map((h) => h.day).join(', ')}`)
    assert(hist[0].day === '2026-09-20' && hist[1].day === '2026-09-21', hist.map((h) => h.day).join(', '))
    const { rows: sum } = await db.query(`select value_usd from v_portfolio_summary where portfolio_id = $1`, [portfolioId])
    assert(hist[1].value_usd === sum[0].value_usd, `último ponto ${hist[1].value_usd} ≠ resumo ${sum[0].value_usd}`)
    near(sum[0].value_usd, sheet.expected.totals.valueUsd + Number(sheet.expected.positions.BTC.valueUsd), 0.02, 'com o dobro do BTC')
    return hist.map((h) => `${h.day}: US$ ${Number(h.value_usd).toFixed(2)}`).join(', ')
  })

  await check('23:45 em São Paulo ainda é o mesmo dia (já é o seguinte em UTC)', async () => {
    const { rows } = await db.query(
      `select day::text from v_portfolio_history h join run r on r.id = h.run_id
        where portfolio_id = $1 and r.finished_at = '2026-09-21T23:45:00-03:00'`,
      [portfolioId],
    )
    assert(rows[0]?.day === '2026-09-21', `caiu em ${rows[0]?.day}`)
  })
})

await check('numeric sem teto: PEPE com 10^15 unidades a 0.000012345678901', async () => {
  await inRollback(db, async () => {
    const userId = await createUser(db, `pepe-${crypto.randomUUID()}`)
    const portfolioId = await createPortfolio(db, userId, 'PEPE', null)
    const { rows: a } = await db.query(
      `insert into account (portfolio_id, kind, label, status, created_by) values ($1, 'manual', 'm', 'active', $2) returning id`,
      [portfolioId, userId],
    )
    const runId = await createRun(db, '2026-09-21T12:00:00Z', '5.1059')
    await db.query(`insert into account_sync values ($1, $2, true)`, [runId, a[0].id])
    await db.query(`insert into balance values ($1, $2, 'PEPE', 'manual', '1000000000000000.123456789')`, [runId, a[0].id])
    await db.query(`insert into quote (run_id, ticker, price_usd, source) values ($1, 'PEPE', '0.000012345678901', 'binance')`, [runId])
    const { rows } = await db.query(`select value_usd::text from v_run_position where run_id = $1`, [runId])
    // 1000000000000000.123456789 × 0.000012345678901, sem arredondar nada
    // (conferido com Decimal do Python, precisão 60).
    assert(rows[0].value_usd === '12345678901.000001524157875142508889', `veio ${rows[0].value_usd}`)
  })
})

await db.end()
finish()
