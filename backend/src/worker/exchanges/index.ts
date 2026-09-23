import ccxt from 'ccxt'
import { binanceAccount } from './binance.ts'
import { okxAccount } from './okx.ts'
import type { ExchangeFactory } from './types.ts'

export const liveExchanges: ExchangeFactory = (kind, creds) => (kind === 'binance' ? binanceAccount(creds) : okxAccount(creds))

/**
 * Como tratar um erro da corretora.
 *   auth      — a corretora recusou a chave (inválida, revogada, sem permissão)
 *   transient — rede, fora do ar, rate limit, ou qualquer coisa que não sabemos
 * Na dúvida é transient: uma conta pendente nunca vira ativa por engano, e uma
 * ativa só fica desatualizada.
 */
export function classifyError(err: unknown): 'auth' | 'transient' {
  if (err instanceof ccxt.AuthenticationError || err instanceof ccxt.PermissionDenied || err instanceof ccxt.AccountSuspended) {
    return 'auth'
  }
  return 'transient'
}

/**
 * A mensagem que vai para o log e para a tela. O ccxt embrulha a resposta crua
 * (`binance {"code":-2008,"msg":"Invalid Api-Key ID."}`); Binance e OKX põem a
 * frase em `msg`, então é ela que sai.
 */
export function errorMessage(err: unknown): string {
  // O ccxt põe a URL assinada no erro de rede (timestamp e signature). Não
  // revela a secret, mas não tem por que ir para log nem para o banco.
  const raw = (err instanceof Error ? err.message : String(err)).replace(/(https?:\/\/[^\s?]+)\?\S*/g, '$1')
  const msg = raw.match(/"msg"\s*:\s*"([^"]+)"/)?.[1] ?? raw
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg
}
