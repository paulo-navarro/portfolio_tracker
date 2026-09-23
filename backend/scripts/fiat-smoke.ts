/**
 * Investido calculado — os reais que entraram e saíram das corretoras.
 *
 *   make smoke
 *
 * A leitura da resposta da Binance (sobre a fixture), a sincronização com
 * corretora falsa e a conta da view, como app_worker, numa transação que volta
 * atrás.
 */
import { parseBinanceFiatOrders } from '../src/worker/exchanges/binance.ts'
import { parseOkxFiatOrders } from '../src/worker/exchanges/okx.ts'
import type { FiatFlow } from '../src/worker/exchanges/types.ts'
import { FIAT_START, syncFiat } from '../src/worker/fiat.ts'
import { createPortfolio, createUser } from './fixture.ts'
import { FakeExchanges, FakeMarket, fakeDeps, fixture, insertAccount, throwawayKeys } from './fakes.ts'
import { assert, check, connect, env, finish, inRollback, near } from './lib.ts'

console.log('fiat smoke\n')

const raw = fixture('binance-fiat-orders') as { deposits: { data: Record<string, unknown>[] }; withdrawals: { data: Record<string, unknown>[] } }

await check('Binance: só pedido concluído vira linha', async () => {
  const ins = parseBinanceFiatOrders(raw.deposits.data, 'in')
  assert(ins.map((f) => f.externalId).join() === 'D1,D2,D4', ins.map((f) => f.externalId).join())
  const outs = parseBinanceFiatOrders(raw.withdrawals.data, 'out')
  assert(outs.map((f) => f.externalId).join() === 'W1', outs.map((f) => f.externalId).join())
})

await check('entrada vale o que foi enviado; saída, o que chegou no banco', async () => {
  const eur = parseBinanceFiatOrders(raw.deposits.data, 'in').find((f) => f.externalId === 'D4')!
  assert(eur.amount === '50' && eur.fee === '1' && eur.currency === 'EUR', JSON.stringify(eur))
  const w = parseBinanceFiatOrders(raw.withdrawals.data, 'out')[0]
  assert(w.amount === '299', JSON.stringify(w))
})

const okxRaw = fixture('okx-fiat-orders') as { deposits: { data: Record<string, unknown>[] }; withdrawals: { data: Record<string, unknown>[] } }

await check('OKX: só pedido concluído vira linha', async () => {
  const ins = parseOkxFiatOrders(okxRaw.deposits.data, 'in')
  assert(ins.map((f) => `${f.externalId}=${f.amount}`).join() === 'O1=100,O2=3000', ins.map((f) => f.externalId).join())
  const outs = parseOkxFiatOrders(okxRaw.withdrawals.data, 'out')
  // Saída vale o que chegou no banco: 200 − 2 de taxa.
  assert(outs.map((f) => `${f.externalId}=${f.amount}`).join() === 'OW1=198', JSON.stringify(outs))
})

await check('OKX: método do pagamento e moeda vêm junto', async () => {
  const f = parseOkxFiatOrders(okxRaw.deposits.data, 'in')[0]
  assert(f.method === 'PIX' && f.currency === 'BRL' && f.at.toISOString().slice(0, 10) === '2025-04-14', JSON.stringify(f))
})

const db = await connect(env.ownerUrl)
const keys = await throwawayKeys()
const day = (iso: string) => new Date(`${iso}T12:00:00Z`)
const flow = (id: string, direction: 'in' | 'out', amount: string, at: string, currency = 'BRL'): FiatFlow => ({
  externalId: id,
  direction,
  currency,
  amount,
  fee: '0',
  method: 'Bank Transfer (PIX)',
  at: day(at),
})

await inRollback(db, async () => {
  await db.query('update account set removed_at = now(), sealed_credentials = null where removed_at is null')
  const userId = await createUser(db, `fiat-${crypto.randomUUID()}`)
  const portfolioId = await createPortfolio(db, userId, 'Fiat', null)
  const binId = await insertAccount(db, { portfolioId, userId, kind: 'binance', apiKey: 'bin', keys, status: 'active', uid: 'b1' })
  const okxId = await insertAccount(db, { portfolioId, userId, kind: 'okx', apiKey: 'okx', keys, status: 'active', uid: 'o1' })

  const ex = new FakeExchanges()
  ex.behaviors.set('bin', {
    fiat: [flow('D1', 'in', '1500.50', '2021-05-24'), flow('D2', 'in', '100', '2026-04-21'), flow('D3', 'in', '50', '2024-03-01', 'EUR'), flow('W1', 'out', '299', '2025-06-15')],
  })
  // A OKX também tem histórico (desde 22/09/2026); a conta sem `fiat` é que
  // devolve null, como uma corretora ainda não implementada.
  ex.behaviors.set('okx', { fiat: [flow('O1', 'in', '3000', '2024-12-22')] })
  const semHistId = await insertAccount(db, { portfolioId, userId, kind: 'okx', apiKey: 'semhist', keys, status: 'active', uid: 'o2' })
  ex.behaviors.set('semhist', { fiat: null })
  const clock = { now: day('2026-09-22') }
  const d = fakeDeps(db, keys, ex, new FakeMarket(), clock)
  await db.query('set local role app_worker')

  await syncFiat(d)

  await check('primeira busca vai desde jul/2017', async () => {
    assert(ex.fiatSince.bin?.[0]?.getTime() === FIAT_START.getTime(), String(ex.fiatSince.bin?.[0]))
  })

  const invested = async () =>
    (await db.query(`select invested_calc_brl::text as brl, deposits, withdrawals, first_at::date::text as first from v_portfolio_invested where portfolio_id = $1`, [portfolioId]))
      .rows[0]

  await check('investido soma as duas corretoras, só em BRL', async () => {
    const i = await invested()
    // Binance 1500,50 + 100 − 299, mais OKX 3000; o depósito em EUR não entra.
    assert(i.brl === '4301.50' && Number(i.deposits) === 3 && Number(i.withdrawals) === 1 && i.first === '2021-05-24', JSON.stringify(i))
  })

  await check('corretora sem histórico implementado fica sem data de busca', async () => {
    const { rows } = await db.query(`select fiat_synced_at from account where id in ($1, $2) order by fiat_synced_at nulls last`, [okxId, semHistId])
    assert(rows[0].fiat_synced_at !== null && rows[1].fiat_synced_at === null, JSON.stringify(rows))
  })

  await check('menos de 24h depois não busca de novo', async () => {
    clock.now = day('2026-09-22')
    clock.now.setHours(clock.now.getHours() + 5)
    await syncFiat(d)
    assert(ex.fiatSince.bin.length === 1, `buscou ${ex.fiatSince.bin.length} vezes`)
  })

  await check('no dia seguinte busca só os últimos 7 dias, e repetir não duplica', async () => {
    ex.behaviors.get('bin')!.fiat!.push(flow('D9', 'in', '400', '2026-09-22'))
    // Uma hora a mais que 24h depois da primeira busca.
    clock.now = new Date('2026-09-23T13:00:00Z')
    await syncFiat(d)
    const since = ex.fiatSince.bin[1]
    near((day('2026-09-22').getTime() - since.getTime()) / 86_400_000, 7, 0, 'dias de sobreposição')
    // D9 entra; D2 (abr/2026) ficou fora da janela; nada duplica.
    const i = await invested()
    assert(i.brl === '4701.50' && Number(i.deposits) === 4, JSON.stringify(i))
  })

  await check('busca que falha tenta de novo na próxima (a data não muda)', async () => {
    ex.behaviors.get('bin')!.fiatError = true
    clock.now = new Date('2026-09-25T13:00:00Z')
    await syncFiat(d)
    const { rows } = await db.query(`select fiat_synced_at::date::text as d from account where id = $1`, [binId])
    assert(rows[0].d === '2026-09-23', rows[0].d)
  })

  await check('conta removida sai do investido', async () => {
    await db.query('reset role')
    await db.query(`update account set removed_at = now(), sealed_credentials = null where id in ($1, $2)`, [binId, okxId])
    const i = await invested()
    assert(i === undefined, JSON.stringify(i))
  })
})

await db.end()
finish()
