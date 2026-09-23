import type { FastifyReply } from 'fastify'
import { query } from '../db/pool.ts'

/**
 * Erro com frase para gente. O handler de erro do server devolve
 * `{ error: message }` com o status; qualquer outro erro vira 500 genérico.
 */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const notFound = () => new HttpError(404, 'não encontrado.')

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Id que não é uuid é indistinguível de não existir (e não vira 500 no cast). */
export function uuidParam(value: string): string {
  if (!UUID_RE.test(value)) throw notFound()
  return value
}

/**
 * snake_case do banco → camelCase do JSON (chg_24h → chg24h). Números
 * `numeric` continuam string.
 */
export function camel<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v
  return out
}

export type Role = 'owner' | 'viewer'

/**
 * O papel do usuário no portfólio, ou 404. Portfólio de outra pessoa e
 * portfólio que não existe são a mesma resposta: não dá para descobrir ids.
 */
export async function requireMember(userId: string, portfolioId: string, min: Role = 'viewer'): Promise<Role> {
  uuidParam(portfolioId)
  const { rows } = await query<{ role: Role }>(
    `select m.role from portfolio_member m join portfolio p on p.id = m.portfolio_id
      where m.portfolio_id = $1 and m.user_id = $2`,
    [portfolioId, userId],
  )
  const role = rows[0]?.role
  if (!role) throw notFound()
  if (min === 'owner' && role !== 'owner') throw new HttpError(403, 'só quem é dono do portfólio pode fazer isso.')
  return role
}

/** O portfólio da conta, conferindo o papel. Conta removida conta como inexistente. */
export async function requireAccount(userId: string, accountId: string, min: Role = 'viewer') {
  uuidParam(accountId)
  const { rows } = await query<{ portfolio_id: string; kind: string; status: string }>(
    `select portfolio_id, kind, status from account where id = $1 and removed_at is null`,
    [accountId],
  )
  if (!rows[0]) throw notFound()
  await requireMember(userId, rows[0].portfolio_id, min)
  return rows[0]
}

export function noContent(reply: FastifyReply) {
  return reply.code(204).send()
}
