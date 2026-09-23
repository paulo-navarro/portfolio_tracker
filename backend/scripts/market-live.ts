/**
 * Consulta de verdade os endpoints públicos (sem chave nenhuma) e mostra o que
 * o worker gravaria. Não é smoke: depende de rede e do mercado do momento.
 *
 *   make market-live TICKERS="BTC ETH HBAR"
 */
import { liveMarket } from '../src/worker/market.ts'

const tickers = (process.env.TICKERS ?? 'BTC ETH').split(/\s+/).filter(Boolean).map((t) => t.toUpperCase())
const market = liveMarket()

const { quotes, usdBrl } = await market.fetchQuotes(tickers)
console.log(`USDT/BRL ${usdBrl}\n`)
for (const t of tickers) {
  const q = quotes.find((x) => x.ticker === t)
  const ath = await market.fetchAth(t)
  if (!q) {
    console.log(`${t.padEnd(8)} sem cotação                                     ATH ${ath ?? '—'}`)
    continue
  }
  const f = (v: string | null) => (v === null ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`)
  console.log(`${t.padEnd(8)} ${q.source.padEnd(8)} US$ ${q.priceUsd.padEnd(16)} 24h ${f(q.chg24h).padEnd(8)} 7d ${f(q.chg7d).padEnd(8)} ATH ${ath ?? '—'}`)
}
