import ccxt from 'ccxt'
import { checkOkx } from './permissions.ts'
import { normalizeTicker, positiveAmount, type Credentials, type ExchangeAccount, type FiatFlow, type Holding } from './types.ts'

type Row = Record<string, unknown>
type Envelope = { data?: Row[] }

export interface OkxRaw {
  /** `privateGetAccountBalance`: data[0].details[] com ccy, eq. */
  trading: Envelope
  /** `privateGetAssetBalances`: data[] com ccy, bal. */
  funding: Envelope
  /** `privateGetFinanceSavingsBalance`: data[] com ccy, amt. */
  savings: Envelope
  /** `privateGetFinanceStakingDefiOrdersActive`: data[].investData[] com ccy, amt. */
  staking: Envelope
}

function push(out: Holding[], wallet: Holding['wallet'], ticker: unknown, amount: unknown) {
  const t = normalizeTicker(ticker)
  const a = positiveAmount(amount)
  if (t && a) out.push({ ticker: t, wallet, amount: a })
}

export function parseOkx(raw: OkxRaw): Holding[] {
  const out: Holding[] = []
  for (const acc of raw.trading.data ?? []) {
    for (const d of (acc.details as Row[] | undefined) ?? []) push(out, 'trading', d.ccy, d.eq)
  }
  for (const f of raw.funding.data ?? []) push(out, 'funding', f.ccy, f.bal)
  for (const s of raw.savings.data ?? []) push(out, 'savings', s.ccy, s.amt)
  for (const order of raw.staking.data ?? []) {
    for (const i of (order.investData as Row[] | undefined) ?? []) push(out, 'staking', i.ccy, i.amt)
  }
  return out
}

/**
 * `privateGetFiatDepositOrderHistory` e `privateGetFiatWithdrawalOrderHistory`
 * (GET /api/v5/fiat/{deposit,withdrawal}-order-history): pedidos em moeda
 * fiduciária. Só `completed` entra.
 *
 * `amt` é o valor do pedido e `fee` vem à parte, então a entrada vale `amt` e a
 * saída, `amt - fee` (o que chegou no banco), como na Binance.
 */
export function parseOkxFiatOrders(rows: Row[], direction: 'in' | 'out'): FiatFlow[] {
  const out: FiatFlow[] = []
  for (const r of rows) {
    if (r.state !== 'completed') continue
    const amt = Number(r.amt)
    const fee = positiveAmount(r.fee) ?? '0'
    const at = Number(r.cTime)
    const currency = String(r.ccy ?? '').toUpperCase()
    if (!Number.isFinite(amt) || amt <= 0 || !Number.isFinite(at) || typeof r.ordId !== 'string' || !r.ordId) continue
    if (!/^[A-Z]{3}$/.test(currency)) continue
    const amount = direction === 'in' ? String(amt) : String(amt - Number(fee))
    if (Number(amount) <= 0) continue
    out.push({
      externalId: r.ordId,
      direction,
      currency,
      amount,
      fee,
      method: typeof r.paymentMethod === 'string' ? r.paymentMethod : null,
      at: new Date(at),
    })
  }
  return out
}

// A OKX pagina por `after` (pedidos mais antigos que este instante), 100 por vez.
const FIAT_PAGE = 100
const FIAT_MAX_PAGES = 50

export function okxAccount(creds: Credentials): ExchangeAccount {
  const ex = new ccxt.okx({
    apiKey: creds.apiKey,
    secret: creds.secret,
    password: creds.passphrase,
    enableRateLimit: true,
    options: { fetchMarkets: { types: ['spot'] } },
  })

  return {
    async checkPermissions() {
      return checkOkx(await ex.privateGetAccountConfig())
    },
    async fetchUid() {
      const res = (await ex.privateGetAccountConfig()) as Envelope
      const uid = res.data?.[0]?.uid
      if (!uid) throw new Error('a OKX não mandou o uid da conta')
      return String(uid)
    },
    async fetchBalances() {
      const [trading, funding, savings, staking] = (await Promise.all([
        ex.privateGetAccountBalance(),
        ex.privateGetAssetBalances(),
        ex.privateGetFinanceSavingsBalance(),
        ex.privateGetFinanceStakingDefiOrdersActive(),
      ])) as Envelope[]
      return parseOkx({ trading, funding, savings, staking })
    },
    async fetchFiatFlows(since) {
      const out: FiatFlow[] = []
      for (const [method, direction] of [
        ['privateGetFiatDepositOrderHistory', 'in'],
        ['privateGetFiatWithdrawalOrderHistory', 'out'],
      ] as const) {
        let after: string | undefined
        for (let page = 0; page < FIAT_MAX_PAGES; page++) {
          const params: Record<string, string> = { limit: String(FIAT_PAGE), begin: String(since.getTime()) }
          if (after) params.after = after
          const res = (await (ex as unknown as Record<string, (p: unknown) => Promise<Envelope>>)[method](params)) as Envelope
          const rows = res.data ?? []
          out.push(...parseOkxFiatOrders(rows, direction))
          if (rows.length < FIAT_PAGE) break
          // Próxima página: mais antigos que o mais antigo desta.
          after = String(Math.min(...rows.map((r) => Number(r.cTime)).filter(Number.isFinite)))
        }
      }
      return out
    },
  }
}
