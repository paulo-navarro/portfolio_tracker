/**
 * A api, do jeito que a tela usa. Mesma origem (o Vite em dev e o nginx em
 * prod repassam /api), então o cookie de sessão vai sozinho.
 */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'sem conexão com o servidor.')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `erro ${res.status}`)
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

// ── Formas das respostas ────────────────────────────
// Números vêm como string (numeric do Postgres) e só viram number na hora de
// formatar: saldo nunca passa por conta de float na tela.

export type Num = string | null

export interface Me {
  user: { id: string; email: string; name: string | null }
  portfolios: { id: string; name: string; role: 'owner' | 'viewer' }[]
}

export interface Summary {
  id: string
  name: string
  role: 'owner' | 'viewer'
  investedBrl: Num
  asOf: string | null
  usdBrl: Num
  valueUsd: Num
  valueBrl: Num
  valueAtAthUsd: Num
  valueAtAthBrl: Num
  athMultiple: Num
  chg24h: Num
  chg7d: Num
  resultPct: Num
  unpriced: number
  stale: boolean
  // Só no /summary: o investido pelos depósitos em reais das corretoras.
  investedCalcBrl?: Num
  investedCalcDeposits?: number | null
  investedCalcWithdrawals?: number | null
  investedCalcSince?: string | null
  investedCalcMissing?: number
  resultCalcPct?: Num
}

export interface Position {
  ticker: string
  qty: string
  priceUsd: Num
  athUsd: Num
  pctBelowAth: Num
  /** Quanto o preço passou do topo anterior, quando está acima dele. */
  pctAboveAth: Num
  valueUsd: Num
  valueAtAthUsd: Num
  valueAtAthBrl: Num
  allocationPct: Num
  priceBrl: Num
  valueBrl: Num
  chg24h: Num
  chg7d: Num
  stale: boolean
}

export interface Source {
  accountId: string
  kind: 'binance' | 'okx' | 'manual'
  label: string
  wallet: string
  ticker: string
  amount: string
  valueUsd: Num
  valueBrl: Num
  stale: boolean
}

export interface HistoryPoint {
  day: string
  valueUsd: Num
  valueBrl: Num
}

export type AccountStatus = 'pending' | 'active' | 'rejected' | 'blocked' | 'error'

export interface Account {
  id: string
  kind: 'binance' | 'okx' | 'manual'
  label: string
  status: AccountStatus
  statusReason: string | null
  keyHint: string | null
  ipRestricted: boolean | null
  checkedAt: string | null
  createdAt: string
  lastSyncAt: string | null
}

export interface Holding {
  ticker: string
  amount: string
  note: string | null
}

export interface SessionInfo {
  id: string
  createdAt: string
  lastSeenAt: string
  userAgent: string | null
  current: boolean
}

export interface Meta {
  workerAlive: boolean
  lastRunAt: string | null
  lastCycleAt: string | null
  lastError: string | null
  collectIntervalMin: number
  egressIp: string | null
}

export type Range = '7d' | '30d' | '90d' | '1y' | 'all'
