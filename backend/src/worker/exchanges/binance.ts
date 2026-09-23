import ccxt from 'ccxt'
import { checkBinance } from './permissions.ts'
import { normalizeTicker, positiveAmount, type Credentials, type ExchangeAccount, type FiatFlow, type Holding } from './types.ts'

type Row = Record<string, unknown>

export interface BinanceRaw {
  /** `privateGetAccount` (GET /api/v3/account): `balances[]` com asset, free, locked. */
  account: { balances?: Row[] }
  /** `sapiPostAssetGetFundingAsset`: [{asset, free, locked, freeze, withdrawing}]. */
  funding: Row[]
  /** Todas as páginas de `sapiGetSimpleEarnFlexiblePosition`: rows[] com asset, totalAmount. */
  flexible: Row[]
  /** Todas as páginas de `sapiGetSimpleEarnLockedPosition`: rows[] com asset, amount. */
  locked: Row[]
}

function push(out: Holding[], wallet: Holding['wallet'], ticker: unknown, amount: unknown) {
  const t = normalizeTicker(ticker)
  const a = positiveAmount(amount)
  if (t && a) out.push({ ticker: t, wallet, amount: a })
}

/**
 * Respostas cruas → saldos. O spot pode listar o earn flexível como `LD<X>`
 * (o recibo do Simple Earn): ignora **só se X estiver no earn flexível**, senão
 * contaria duas vezes. `LDO` é ticker de verdade e passa.
 */
export function parseBinance(raw: BinanceRaw): Holding[] {
  const out: Holding[] = []
  const flexibleAssets = new Set(raw.flexible.map((r) => normalizeTicker(r.asset)).filter(Boolean))

  for (const b of raw.account.balances ?? []) {
    const asset = normalizeTicker(b.asset)
    if (asset?.startsWith('LD') && flexibleAssets.has(asset.slice(2))) continue
    push(out, 'spot', b.asset, b.free)
    push(out, 'spot', b.asset, b.locked)
  }
  for (const f of raw.funding) {
    for (const field of ['free', 'locked', 'freeze', 'withdrawing']) push(out, 'funding', f.asset, f[field])
  }
  for (const r of raw.flexible) push(out, 'earn_flexible', r.asset, r.totalAmount)
  for (const r of raw.locked) push(out, 'earn_locked', r.asset, r.amount)
  return out
}

/**
 * `sapiGetFiatOrders` (GET /sapi/v1/fiat/orders): depósito (transactionType 0) e
 * saque (1) em moeda fiduciária. Só `Successful` entra: `Expired`, `Failed` e
 * `Processing` não moveram dinheiro (ainda). Na entrada vale o que foi enviado
 * (`indicatedAmount`); na saída, o que chegou no banco (`amount`).
 */
export function parseBinanceFiatOrders(rows: Row[], direction: 'in' | 'out'): FiatFlow[] {
  const out: FiatFlow[] = []
  for (const r of rows) {
    if (r.status !== 'Successful') continue
    const amount = positiveAmount(direction === 'in' ? r.indicatedAmount : r.amount)
    const at = Number(r.createTime)
    if (!amount || typeof r.orderNo !== 'string' || !r.orderNo || !Number.isFinite(at)) continue
    const currency = String(r.fiatCurrency ?? '').toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) continue
    out.push({
      externalId: r.orderNo,
      direction,
      currency,
      amount,
      fee: positiveAmount(r.totalFee) ?? '0',
      method: typeof r.method === 'string' ? r.method : null,
      at: new Date(at),
    })
  }
  return out
}

// Janelas de 5 anos: conferido numa conta real (22/09/2026) que uma chamada
// cobre 5 anos. Janela menor custaria caro: essa rota pesa 90.000 da cota de
// 180.000 por minuto da conta, e o ccxt espaça cada chamada em ~30 s. 500
// linhas por janela sobra para PIX.
const FIAT_WINDOW_MS = 5 * 365 * 24 * 60 * 60 * 1000

/** Simple Earn pagina com `current` (1..n) e `size` até 100; `total` é o número de linhas. */
async function allPages(call: (params: Row) => Promise<unknown>): Promise<Row[]> {
  const rows: Row[] = []
  for (let current = 1; current <= 50; current++) {
    const res = (await call({ current, size: 100 })) as { rows?: Row[]; total?: number }
    rows.push(...(res.rows ?? []))
    if (!res.rows?.length || rows.length >= Number(res.total ?? 0)) break
  }
  return rows
}

export function binanceAccount(creds: Credentials): ExchangeAccount {
  const ex = new ccxt.binance({
    apiKey: creds.apiKey,
    secret: creds.secret,
    enableRateLimit: true,
    options: { adjustForTimeDifference: true, fetchMarkets: { types: ['spot'] } },
  })

  return {
    async checkPermissions() {
      return checkBinance(await ex.sapiGetAccountApiRestrictions())
    },
    async fetchUid() {
      const account = (await ex.privateGetAccount({ omitZeroBalances: true })) as Row
      if (account.uid === undefined || account.uid === null) throw new Error('a Binance não mandou o uid da conta')
      return String(account.uid)
    },
    async fetchBalances() {
      const [account, funding, flexible, locked] = await Promise.all([
        ex.privateGetAccount({ omitZeroBalances: true }) as Promise<BinanceRaw['account']>,
        ex.sapiPostAssetGetFundingAsset() as Promise<Row[]>,
        allPages((p) => ex.sapiGetSimpleEarnFlexiblePosition(p)),
        allPages((p) => ex.sapiGetSimpleEarnLockedPosition(p)),
      ])
      return parseBinance({ account, funding, flexible, locked })
    },
    async fetchFiatFlows(since) {
      const out: FiatFlow[] = []
      for (let begin = since.getTime(); begin < Date.now(); begin += FIAT_WINDOW_MS) {
        const end = Math.min(begin + FIAT_WINDOW_MS, Date.now())
        for (const [type, direction] of [[0, 'in'], [1, 'out']] as const) {
          const res = (await ex.sapiGetFiatOrders({ transactionType: type, beginTime: begin, endTime: end, rows: 500 })) as { data?: Row[] }
          out.push(...parseBinanceFiatOrders(res.data ?? [], direction))
        }
      }
      return out
    },
  }
}
