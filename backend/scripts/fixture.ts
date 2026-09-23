/**
 * Carrega a planilha de 21/09/2026 (fixtures/planilha-2026-09-21.json) como se
 * fosse uma coleta do worker: usuário, portfólio, três contas, uma coleta ok
 * com saldos e cotações, e o ATH de cada ativo.
 *
 * Roda como dono, dentro da transação do chamador (inRollback): nada fica.
 */
import { readFileSync } from 'node:fs'
import type pg from 'pg'

export interface Sheet {
  usdBrl: string
  investedBrl: string
  accounts: { key: string; kind: 'binance' | 'okx' | 'manual'; label: string }[]
  balances: { account: string; ticker: string; wallet: string; amount: string }[]
  quotes: { ticker: string; priceUsd: string; chg24h: string; chg7d: string | null }[]
  ath: Record<string, string>
  expected: {
    positions: Record<string, Record<string, number | string | null>>
    totals: Record<string, number>
  }
}

export const sheet: Sheet = JSON.parse(
  readFileSync(new URL('../fixtures/planilha-2026-09-21.json', import.meta.url), 'utf8'),
)

export interface Loaded {
  userId: string
  portfolioId: string
  accountIds: Record<string, string>
  runId: string
}

export async function createUser(db: pg.Client, sub: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into app_user (google_sub, email, name) values ($1, $1 || '@example.com', 'Smoke') returning id`,
    [sub],
  )
  return rows[0].id
}

export async function createPortfolio(db: pg.Client, userId: string, name: string, investedBrl: string | null) {
  const { rows } = await db.query<{ id: string }>(
    `insert into portfolio (name, invested_brl) values ($1, $2) returning id`,
    [name, investedBrl],
  )
  await db.query(`insert into portfolio_member (portfolio_id, user_id, role) values ($1, $2, 'owner')`, [rows[0].id, userId])
  return rows[0].id
}

/** Uma coleta ok, com `finishedAt` escolhido (para testar o histórico por dia). */
export async function createRun(db: pg.Client, finishedAt: string, usdBrl: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into run (started_at, finished_at, status, usd_brl) values ($1, $1, 'ok', $2) returning id`,
    [finishedAt, usdBrl],
  )
  return rows[0].id
}

export async function loadSheet(db: pg.Client, finishedAt = '2026-09-21T18:56:00-03:00'): Promise<Loaded> {
  const userId = await createUser(db, `smoke-${crypto.randomUUID()}`)
  const portfolioId = await createPortfolio(db, userId, 'Principal', sheet.investedBrl)

  const accountIds: Record<string, string> = {}
  for (const a of sheet.accounts) {
    const { rows } = await db.query<{ id: string }>(
      `insert into account (portfolio_id, kind, label, status, created_by) values ($1, $2, $3, 'active', $4) returning id`,
      [portfolioId, a.kind, a.label, userId],
    )
    accountIds[a.key] = rows[0].id
  }

  const runId = await createRun(db, finishedAt, sheet.usdBrl)
  for (const id of Object.values(accountIds)) {
    await db.query(`insert into account_sync (run_id, account_id, ok) values ($1, $2, true)`, [runId, id])
  }
  for (const b of sheet.balances) {
    await db.query(`insert into balance (run_id, account_id, ticker, wallet, amount) values ($1, $2, $3, $4, $5)`, [
      runId,
      accountIds[b.account],
      b.ticker,
      b.wallet,
      b.amount,
    ])
  }
  for (const q of sheet.quotes) {
    await db.query(
      `insert into quote (run_id, ticker, price_usd, chg_24h, chg_7d, source) values ($1, $2, $3, $4, $5, 'binance')`,
      [runId, q.ticker, q.priceUsd, q.chg24h, q.chg7d],
    )
  }
  for (const [ticker, ath] of Object.entries(sheet.ath)) {
    await db.query(
      `insert into asset (ticker, ath_usd, ath_checked_at) values ($1, $2, now())
       on conflict (ticker) do update set ath_usd = excluded.ath_usd`,
      [ticker, ath],
    )
  }

  return { userId, portfolioId, accountIds, runId }
}
