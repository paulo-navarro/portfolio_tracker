/**
 * Número na tela, sempre pt-BR. Variação sempre com sinal (+/−), nunca só cor.
 * O menos é o sinal tipográfico (U+2212), da mesma largura do mais.
 */
const MINUS = '−'

function n(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : null
}

function fixed(x: number, digits: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x).replace('-', MINUS)
}

/** Casas suficientes para um preço baixo não virar 0,00 (PEPE a 0,00000482). */
function priceDigits(x: number): number {
  const a = Math.abs(x)
  if (a >= 1 || a === 0) return 2
  return Math.min(10, Math.max(2, -Math.floor(Math.log10(a)) + 3))
}

export const DASH = '—'

export function brl(v: string | number | null | undefined): string {
  const x = n(v)
  return x === null ? DASH : `R$ ${fixed(x, 2)}`
}

export function usd(v: string | number | null | undefined): string {
  const x = n(v)
  return x === null ? DASH : `US$ ${fixed(x, 2)}`
}

export function priceUsd(v: string | number | null | undefined): string {
  const x = n(v)
  return x === null ? DASH : `US$ ${fixed(x, priceDigits(x))}`
}

export function priceBrl(v: string | number | null | undefined): string {
  const x = n(v)
  return x === null ? DASH : `R$ ${fixed(x, priceDigits(x))}`
}

/** "R$ 62,2 mil", "R$ 1,4 mi": para frases, não para colunas. */
export function brlCompact(v: string | number | null | undefined): string {
  const x = n(v)
  if (x === null) return DASH
  const f = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(x)
  return `R$ ${f}`
}

/** "14,3 mil": rótulo de eixo, sem moeda. */
export function compact(v: string | number | null | undefined): string {
  const x = n(v)
  return x === null ? DASH : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(x)
}

/** +5,38% · −3,88% · 0,00% */
export function signedPct(v: string | number | null | undefined, digits = 2): string {
  const x = n(v)
  if (x === null) return DASH
  const s = fixed(Math.abs(x), digits)
  return x > 0 ? `+${s}%` : x < 0 ? `${MINUS}${s}%` : `${s}%`
}

export function pct(v: string | number | null | undefined, digits = 2): string {
  const x = n(v)
  return x === null ? DASH : `${fixed(x, digits)}%`
}

/** "4,5×" */
export function multiple(v: string | number | null | undefined): string {
  const x = n(v)
  return x === null ? DASH : `${fixed(x, 1)}×`
}

/** Quantidade de moeda: até 8 casas, sem zero sobrando no fim. */
export function qty(v: string | number | null | undefined): string {
  const x = n(v)
  if (x === null) return DASH
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(x)
}

/** -1, 0 ou 1: para a cor da variação (que nunca vem sozinha, sempre com o sinal). */
export function trend(v: string | number | null | undefined): 'up' | 'down' | 'flat' {
  const x = n(v)
  return x === null || x === 0 ? 'flat' : x > 0 ? 'up' : 'down'
}

export function num(v: string | number | null | undefined): number | null {
  return n(v)
}

/** "há 4 min", "há 2 h", "há 3 dias" */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'agora'
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.round(h / 24)} dias`
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return DASH
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

/** "mai/2021" */
export function monthYear(iso: string | null | undefined): string {
  if (!iso) return DASH
  const f = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(new Date(iso))
  return f.replace('.', '').replace(' de ', '/')
}

export function dayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  // "22 ago": o "de" e o ponto do pt-BR só ocupam espaço no eixo.
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
    .format(new Date(y, m - 1, d))
    .replace(' de ', ' ')
    .replace('.', '')
}

export function dayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(y, m - 1, d))
}

/**
 * Valor em reais digitado do jeito brasileiro → string decimal para a api
 * ("12345.00"), ou null se não der para entender.
 *
 *   "12.345"  "12.345,00"  "12345"  "12345,5"  "R$ 12.345,00"  "12 345"
 *
 * Vírgula é decimal. Sem vírgula, ponto seguido de grupos de 3 dígitos é
 * milhar ("12.345" = doze mil trezentos e quarenta e cinco); com 1 ou 2 casas
 * depois, é decimal ("12345.5"). Vazio vira "" (apagar o valor).
 */
export function parseBrl(input: string): string | null {
  const s = input.replace(/R\$/gi, '').replace(/[\s ]/g, '')
  if (s === '') return ''
  let normalized: string
  if (s.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(s)) return null
    normalized = s.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, '')
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
    normalized = s
  } else {
    return null
  }
  return /^\d{1,15}(\.\d{1,2})?$/.test(normalized) ? normalized : null
}
