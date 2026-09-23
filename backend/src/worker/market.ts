/**
 * Preço, 24h, 7d, câmbio e ATH. Só endpoints públicos: nenhuma chave.
 *
 * Binance primeiro; o que não estiver lá, OKX; stablecoin vale 1. Preço em
 * USDT é tratado como dólar, e o câmbio é o USDT/BRL da Binance (o que se
 * obteria vendendo lá).
 */
import ccxt from 'ccxt'
import { config } from '../config.ts'

export interface Quote {
  ticker: string
  priceUsd: string
  chg24h: string | null
  chg7d: string | null
  source: 'binance' | 'okx' | 'stable'
}

export interface MarketData {
  /** Cotações dos tickers pedidos (os que não acharem preço ficam de fora) e o câmbio. */
  fetchQuotes(tickers: string[]): Promise<{ quotes: Quote[]; usdBrl: string }>
  /** ATH em dólar, ou null se não souber. */
  fetchAth(ticker: string): Promise<string | null>
}

type Row = Record<string, unknown>

// Decimal como a corretora manda: "86570.01", "-3.880". Sem expoente.
const DECIMAL_RE = /^-?\d+(\.\d+)?$/
// O cryptoprices.cc pode mandar expoente para moeda muito barata.
const ATH_RE = /^\d+(\.\d+)?(e-?\d+)?$/i

function num(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return DECIMAL_RE.test(s) ? s : null
}

function pct(now: unknown, before: unknown): string | null {
  const a = Number(now)
  const b = Number(before)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null
  return String((a / b - 1) * 100)
}

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/**
 * Junta as respostas em cotações. Separado da rede para dar para testar.
 *
 * - binance24h: todas as linhas de `publicGetTicker24hr` (sem `symbols`: um
 *   símbolo inexistente derruba a chamada inteira, então pede tudo e filtra aqui)
 * - binance7d: `publicGetTicker` com `windowSize: '7d'`, só dos que existem
 * - okx: o que faltou, já com 24h e 7d
 */
export function assembleQuotes(
  tickers: string[],
  stablecoins: string[],
  binance24h: Map<string, Row>,
  binance7d: Map<string, Row>,
  okx: Map<string, Omit<Quote, 'ticker' | 'source'>>,
): Quote[] {
  const stable = new Set(stablecoins)
  const out: Quote[] = []
  for (const ticker of tickers) {
    if (stable.has(ticker)) {
      out.push({ ticker, priceUsd: '1', chg24h: '0', chg7d: '0', source: 'stable' })
      continue
    }
    const b = binance24h.get(`${ticker}USDT`)
    const price = num(b?.lastPrice)
    if (b && price) {
      out.push({
        ticker,
        priceUsd: price,
        chg24h: num(b.priceChangePercent),
        chg7d: num(binance7d.get(`${ticker}USDT`)?.priceChangePercent),
        source: 'binance',
      })
      continue
    }
    const o = okx.get(ticker)
    if (o) out.push({ ticker, ...o, source: 'okx' })
  }
  return out
}

export function liveMarket(): MarketData {
  const binance = new ccxt.binance({ enableRateLimit: true })
  const okx = new ccxt.okx({ enableRateLimit: true })

  async function okxQuote(ticker: string, tickerRow: Row): Promise<Omit<Quote, 'ticker' | 'source'> | null> {
    const price = num(tickerRow.last)
    if (!price) return null
    // Velas de 1 hora: a 169ª é de exatamente 7 dias atrás (a diária erraria
    // por até um dia). Falhar aqui só deixa o 7d vazio.
    let chg7d: string | null = null
    try {
      const res = (await okx.publicGetMarketCandles({ instId: `${ticker}-USDT`, bar: '1H', limit: '169' })) as { data?: string[][] }
      const oldest = res.data?.[168]
      if (oldest) chg7d = pct(price, oldest[4])
    } catch {
      chg7d = null
    }
    return { priceUsd: price, chg24h: pct(price, tickerRow.open24h), chg7d }
  }

  return {
    async fetchQuotes(tickers) {
      const all24h = (await binance.publicGetTicker24hr()) as Row[]
      const binance24h = new Map(all24h.map((r) => [String(r.symbol), r]))

      const usdBrl = num(binance24h.get('USDTBRL')?.lastPrice)
      if (!usdBrl || Number(usdBrl) <= 0) throw new Error('a Binance não mandou o USDT/BRL')

      const stable = new Set(config.stablecoins)
      const wanted = tickers.filter((t) => !stable.has(t))
      const onBinance = wanted.filter((t) => num(binance24h.get(`${t}USDT`)?.lastPrice))

      // Daqui para baixo nada é essencial: sem o 7d, a coluna fica vazia; sem
      // a OKX, o que não está na Binance fica sem cotação. A coleta segue.
      const binance7d = new Map<string, Row>()
      try {
        for (const group of chunks(onBinance.map((t) => `${t}USDT`), 100)) {
          const rows = (await binance.publicGetTicker({ symbols: JSON.stringify(group), windowSize: '7d' })) as Row[]
          for (const r of rows) binance7d.set(String(r.symbol), r)
        }
      } catch (err) {
        console.log(`[worker] binance 7d failed, leaving it empty: ${err instanceof Error ? err.message : String(err)}`)
      }

      const okxQuotes = new Map<string, Omit<Quote, 'ticker' | 'source'>>()
      const missing = wanted.filter((t) => !onBinance.includes(t))
      if (missing.length > 0) {
        try {
          const res = (await okx.publicGetMarketTickers({ instType: 'SPOT' })) as { data?: Row[] }
          const byInst = new Map((res.data ?? []).map((r) => [String(r.instId), r]))
          for (const t of missing) {
            const row = byInst.get(`${t}-USDT`)
            const q = row ? await okxQuote(t, row) : null
            if (q) okxQuotes.set(t, q)
          }
        } catch (err) {
          console.log(`[worker] okx quotes failed, ${missing.join(' ')} unpriced: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      return { quotes: assembleQuotes(tickers, config.stablecoins, binance24h, binance7d, okxQuotes), usdBrl }
    },

    async fetchAth(ticker) {
      const res = await fetch(`https://cryptoprices.cc/${encodeURIComponent(ticker)}/ATH/`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return null
      const text = (await res.text()).trim()
      // A resposta tem que ser um número. Qualquer outra coisa (HTML de erro) é "não sei".
      return ATH_RE.test(text) && Number(text) > 0 ? text : null
    },
  }
}
