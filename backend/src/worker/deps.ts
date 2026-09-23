import type { Db } from '../db/pool.ts'
import type { SealingKeys } from '../sealing.ts'
import type { ExchangeFactory } from './exchanges/types.ts'
import type { MarketData } from './market.ts'

/**
 * Tudo que o worker usa de fora. Em produção é banco, ccxt e relógio de
 * verdade; nos smokes, corretoras falsas e um relógio parado, numa transação
 * que volta atrás.
 */
export interface WorkerDeps {
  /** Escritas avulsas (bloquear conta, rejeitar chave): valem na hora. */
  db: Db
  /** A coleta grava tudo de uma vez: ou entra inteira, ou nada. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>
  exchanges: ExchangeFactory
  market: MarketData
  keys: SealingKeys
  now(): Date
  log(msg: string): void
}

/** `fn` em cada item, no máximo `limit` ao mesmo tempo. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(lanes)
  return out
}
