/**
 * Corretoras, mercado e relógio falsos para os smokes do worker. As regras de
 * permissão e a leitura dos saldos são as de verdade (sobre as fixtures); só a
 * rede é trocada.
 */
import { readFileSync } from 'node:fs'
import ccxt from 'ccxt'
import type pg from 'pg'
import sodium from 'libsodium-wrappers'
import { sealCredentials, type SealingKeys } from '../src/sealing.ts'
import type { WorkerDeps } from '../src/worker/deps.ts'
import { checkBinance, checkOkx } from '../src/worker/exchanges/permissions.ts'
import type { Credentials, ExchangeAccount, ExchangeFactory, FiatFlow, Holding, Kind } from '../src/worker/exchanges/types.ts'
import type { MarketData, Quote } from '../src/worker/market.ts'

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/exchanges/${name}.json`, import.meta.url), 'utf8'))
}

/** Um par de chaves descartável: os smokes nunca tocam na chave do worker. */
export async function throwawayKeys(): Promise<SealingKeys> {
  await sodium.ready
  const kp = sodium.crypto_box_keypair()
  return { publicKey: kp.publicKey, privateKey: kp.privateKey }
}

/** O que uma conta falsa responde. A apiKey da credencial escolhe o comportamento. */
export interface FakeBehavior {
  permissions?: string // nome da fixture de permissão
  uid?: string
  balances?: Holding[]
  error?: 'network' | 'auth'
  /** Histórico de reais; null = corretora sem isso implementado. */
  fiat?: FiatFlow[] | null
  /** Só o histórico falha (a coleta segue). */
  fiatError?: boolean
}

export class FakeExchanges {
  behaviors = new Map<string, FakeBehavior>()
  calls: string[] = []
  /** O `since` de cada fetchFiatFlows, por apiKey. */
  fiatSince: Record<string, Date[]> = {}

  factory: ExchangeFactory = (kind: Kind, creds: Credentials): ExchangeAccount => {
    const b = this.behaviors.get(creds.apiKey)
    if (!b) throw new Error(`fake: sem comportamento para ${creds.apiKey}`)
    const fail = () => {
      if (b.error === 'network') throw new ccxt.NetworkError('fake: connection reset')
      if (b.error === 'auth') throw new ccxt.AuthenticationError('fake: Invalid API-key, IP, or permissions for action.')
    }
    return {
      checkPermissions: async () => {
        this.calls.push(`${creds.apiKey}:permissions`)
        fail()
        const raw = fixture(b.permissions ?? (kind === 'binance' ? 'binance-restrictions-readonly' : 'okx-config-readonly'))
        return kind === 'binance' ? checkBinance(raw) : checkOkx(raw)
      },
      fetchUid: async () => {
        fail()
        return b.uid ?? `uid-${creds.apiKey}`
      },
      fetchBalances: async () => {
        this.calls.push(`${creds.apiKey}:balances`)
        fail()
        return b.balances ?? []
      },
      fetchFiatFlows: async (since: Date) => {
        ;(this.fiatSince[creds.apiKey] ??= []).push(since)
        if (b.fiatError) throw new ccxt.NetworkError('fake: fiat timeout')
        // Como a corretora: só o que é de `since` em diante.
        return b.fiat === null ? null : (b.fiat ?? []).filter((f) => f.at >= since)
      },
    }
  }
}

export class FakeMarket implements MarketData {
  prices: Record<string, string> = { BTC: '85906', ETH: '2742.81', USDT: '1', SOL: '117.08', APT: '0.75' }
  aths: Record<string, string | null> = { BTC: '126080', ETH: '4946.05', SOL: '293.31', APT: '19.92', USDT: '1.32' }
  athCalls: string[] = []
  usdBrl = '5.1059'

  async fetchQuotes(tickers: string[]) {
    const quotes: Quote[] = tickers
      .filter((t) => this.prices[t])
      .map((t) => ({ ticker: t, priceUsd: this.prices[t], chg24h: '1', chg7d: '2', source: t === 'USDT' ? 'stable' : 'binance' }))
    return { quotes, usdBrl: this.usdBrl }
  }

  async fetchAth(ticker: string) {
    this.athCalls.push(ticker)
    return this.aths[ticker] ?? null
  }
}

/** Deps do worker sobre um client em transação: `tx` não abre outra. */
export function fakeDeps(db: pg.Client, keys: SealingKeys, exchanges: FakeExchanges, market: FakeMarket, clock: { now: Date }): WorkerDeps {
  return {
    db,
    tx: (fn) => fn(db),
    exchanges: exchanges.factory,
    market,
    keys,
    now: () => clock.now,
    log: () => {},
  }
}

/** Grava uma conta de corretora pendente, selada, como a api faria. */
export async function insertAccount(
  db: pg.Client,
  opts: { portfolioId: string; userId: string; kind: Kind; apiKey: string; keys: SealingKeys; status?: string; uid?: string },
): Promise<string> {
  const sealed = await sealCredentials({ apiKey: opts.apiKey, secret: 's', passphrase: opts.kind === 'okx' ? 'p' : undefined }, opts.keys.publicKey)
  const { rows } = await db.query<{ id: string }>(
    `insert into account (portfolio_id, kind, label, status, sealed_credentials, key_fingerprint, key_hint, exchange_uid, created_by)
     values ($1, $2, $3, $4, $5, sha256(convert_to($3, 'utf8')), right($3, 4), $6, $7) returning id`,
    [opts.portfolioId, opts.kind, opts.apiKey, opts.status ?? 'pending', Buffer.from(sealed), opts.uid ?? null, opts.userId],
  )
  return rows[0].id
}
