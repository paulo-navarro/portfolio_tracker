/**
 * Regras de permissão. Negar por padrão: só passa o que é certamente só
 * leitura. É a peça que sustenta "no pior caso, alguém vê saldo".
 */
import type { PermissionCheck } from './types.ts'

// Nomes para gente das flags conhecidas. Flag ligada fora desta lista também
// reprova: a Binance cria flag nova com o tempo.
const BINANCE_FLAG_NAMES: Record<string, string> = {
  enableWithdrawals: 'sacar',
  enableSpotAndMarginTrading: 'negociar',
  enableInternalTransfer: 'transferir entre contas',
  permitsUniversalTransfer: 'transferir entre carteiras',
  enableMargin: 'operar margem',
  enableFutures: 'operar futuros',
  enableVanillaOptions: 'operar opções',
  enableFixApiTrade: 'negociar via FIX',
  enablePortfolioMarginTrading: 'operar margem de portfólio',
}

const BINANCE_ALLOWED = new Set(['enableReading', 'enableFixReadOnly'])

const OKX_PERM_NAMES: Record<string, string> = {
  trade: 'negociar',
  withdraw: 'sacar',
}

function denied(powers: string[]): string {
  return `essa chave pode ${powers.join(', ')}. Crie outra só com leitura e revogue esta.`
}

/** Resposta de `sapiGetAccountApiRestrictions`. */
export function checkBinance(restrictions: unknown): PermissionCheck {
  const r = (restrictions ?? {}) as Record<string, unknown>
  const on = Object.entries(r)
    .filter(([k, v]) => /^(enable|permits)/.test(k) && v === true)
    .map(([k]) => k)
  const extra = on.filter((k) => !BINANCE_ALLOWED.has(k))
  const ipRestricted = r.ipRestrict === true

  if (extra.length > 0) {
    return { readOnly: false, reason: denied(extra.map((k) => BINANCE_FLAG_NAMES[k] ?? k)), ipRestricted, raw: restrictions }
  }
  if (!on.includes('enableReading')) {
    return { readOnly: false, reason: 'essa chave não tem permissão de leitura.', ipRestricted, raw: restrictions }
  }
  return { readOnly: true, reason: null, ipRestricted, raw: restrictions }
}

/** Resposta de `privateGetAccountConfig`: `data[0].perm`, separado por vírgula. */
export function checkOkx(config: unknown): PermissionCheck {
  const row = ((config as { data?: unknown[] })?.data?.[0] ?? {}) as Record<string, unknown>
  const perms = String(row.perm ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const ipRestricted = typeof row.ip === 'string' && row.ip.trim() !== ''
  const extra = perms.filter((p) => p !== 'read_only')

  if (extra.length > 0) {
    return { readOnly: false, reason: denied(extra.map((p) => OKX_PERM_NAMES[p] ?? p)), ipRestricted, raw: config }
  }
  if (!perms.includes('read_only')) {
    return { readOnly: false, reason: 'essa chave não tem permissão de leitura.', ipRestricted, raw: config }
  }
  return { readOnly: true, reason: null, ipRestricted, raw: config }
}
