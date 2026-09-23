export type Kind = 'binance' | 'okx'

export type Wallet = 'spot' | 'funding' | 'earn_flexible' | 'earn_locked' | 'trading' | 'savings' | 'staking' | 'manual'

/**
 * Um pedaço de saldo, como a corretora mandou (string, nunca float). O mesmo
 * ticker pode vir mais de uma vez na mesma carteira (free e locked, duas ordens
 * de staking): quem grava soma no Postgres, que soma numeric exato.
 */
export interface Holding {
  ticker: string
  wallet: Wallet
  amount: string
}

export interface Credentials {
  apiKey: string
  secret: string
  passphrase?: string
}

export interface PermissionCheck {
  /** Só leitura. Qualquer outra coisa é false. */
  readOnly: boolean
  /** Frase para gente, quando readOnly é false. */
  reason: string | null
  ipRestricted: boolean
  /** A resposta crua, para account.permissions. */
  raw: unknown
}

/** Um depósito ou saque em moeda fiduciária, já concluído. */
export interface FiatFlow {
  externalId: string
  direction: 'in' | 'out'
  currency: string
  amount: string
  fee: string
  method: string | null
  at: Date
}

/** O que o worker faz com uma conta de corretora. Nada escreve na corretora. */
export interface ExchangeAccount {
  checkPermissions(): Promise<PermissionCheck>
  fetchUid(): Promise<string>
  fetchBalances(): Promise<Holding[]>
  /**
   * Depósitos e saques em reais concluídos entre `since` e agora. null: a
   * corretora ainda não tem isso implementado (e o investido calculado não a conta).
   */
  fetchFiatFlows(since: Date): Promise<FiatFlow[] | null>
}

export type ExchangeFactory = (kind: Kind, creds: Credentials) => ExchangeAccount

export const TICKER_RE = /^[A-Z0-9]{1,20}$/

/** Ticker como o banco aceita, ou null (e o chamador ignora a linha). */
export function normalizeTicker(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toUpperCase()
  return TICKER_RE.test(t) ? t : null
}

/** Quantidade positiva em string decimal, ou null. Zero não vira linha. */
export function positiveAmount(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const s = String(raw).trim()
  if (!/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return null
  return Number(s) > 0 ? s : null
}
