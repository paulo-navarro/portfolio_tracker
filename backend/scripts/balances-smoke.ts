/**
 * Fase 2 — as respostas das corretoras viram os saldos certos?
 *
 *   make smoke
 *
 * Só as funções puras de leitura, sobre as fixtures. Sem rede e sem banco.
 */
import { parseBinance, type BinanceRaw } from '../src/worker/exchanges/binance.ts'
import { parseOkx, type OkxRaw } from '../src/worker/exchanges/okx.ts'
import type { Holding } from '../src/worker/exchanges/types.ts'
import { fixture } from './fakes.ts'
import { assert, check, finish } from './lib.ts'

console.log('balances smoke\n')

const show = (hs: Holding[]) => hs.map((h) => `${h.wallet}:${h.ticker}=${h.amount}`).sort().join(' ')

await check('Binance: spot, funding, earn flexível e travado', async () => {
  const raw = fixture('binance-balances') as { account: BinanceRaw['account']; funding: BinanceRaw['funding']; flexible: { rows: [] }; locked: { rows: [] } }
  const got = show(parseBinance({ account: raw.account, funding: raw.funding, flexible: raw.flexible.rows, locked: raw.locked.rows }))
  const want = [
    'earn_flexible:USDT=25.00000000',
    'earn_locked:SOL=3.50000000',
    'funding:BNB=0.0250',
    'funding:USDT=12.3456',
    // free e locked vêm separados; quem soma é o Postgres, exato.
    'spot:BTC=0.01000000',
    'spot:BTC=0.05000000',
    'spot:HBAR=1234.56789000',
    'spot:LDBTC=0.00010000',
    'spot:LDO=150.00000000',
  ].join(' ')
  assert(got === want, `\n    veio   ${got}\n    queria ${want}`)
})

await check('LD<X> × LDO: LDUSDT some (USDT está no flexível); LDO e LDBTC ficam', async () => {
  const raw = fixture('binance-balances') as { account: BinanceRaw['account']; funding: BinanceRaw['funding']; flexible: { rows: [] }; locked: { rows: [] } }
  const tickers = parseBinance({ account: raw.account, funding: raw.funding, flexible: raw.flexible.rows, locked: raw.locked.rows })
    .filter((h) => h.wallet === 'spot')
    .map((h) => h.ticker)
  assert(!tickers.includes('LDUSDT'), 'LDUSDT contou em dobro com o earn flexível')
  assert(tickers.includes('LDO'), 'LDO (Lido) sumiu: é ticker de verdade')
  // BTC não está no flexível: LDBTC não é recibo de nada que já contamos.
  assert(tickers.includes('LDBTC'), 'LDBTC sumiu sem BTC no flexível')
})

await check('Binance: saldo zero não vira linha', async () => {
  const raw = fixture('binance-balances') as { account: BinanceRaw['account'] }
  const got = parseBinance({ account: raw.account, funding: [], flexible: [], locked: [] })
  assert(!got.some((h) => h.ticker === 'ETH'), 'ETH com 0 virou linha')
})

await check('OKX: trading, funding, savings e staking', async () => {
  const got = show(parseOkx(fixture('okx-balances') as OkxRaw))
  const want = [
    'funding:SUI=12.5',
    'funding:SUI=40',
    'savings:ENA=500',
    'staking:APT=20',
    'staking:APT=5.25',
    'trading:USDT=7.5',
  ].join(' ')
  assert(got === want, `\n    veio   ${got}\n    queria ${want}`)
})

await check('ticker estranho é ignorado, não derruba a coleta', async () => {
  const got = parseOkx({
    trading: { data: [{ details: [{ ccy: 'usdt', eq: '1' }, { ccy: 'BAD-TICKER', eq: '1' }, { ccy: 'BTC', eq: 'NaN' }] }] },
    funding: {},
    savings: {},
    staking: {},
  })
  assert(show(got) === 'trading:USDT=1', show(got))
})

finish()
