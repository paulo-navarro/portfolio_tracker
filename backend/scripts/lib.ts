/**
 * O que os smoke scripts dividem. Rodam no container `smoke` (make smoke), que
 * recebe duas URLs: a do dono, para montar fixture, e a do app_api, para
 * conferir o que a api vê de verdade.
 */
import pg from 'pg'

export const env = {
  ownerUrl: process.env.OWNER_DATABASE_URL ?? '',
  apiUrl: process.env.API_DATABASE_URL ?? '',
  apiBase: process.env.API_URL ?? 'http://api:3001',
}

let failures = 0

export async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn()
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (err) {
    failures++
    console.log(`  ✗ ${name} — ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

/** Número (ou string numérica do pg) a no máximo `tol` do esperado. */
export function near(got: unknown, want: number, tol: number, what: string) {
  const n = Number(got)
  assert(got !== null && Number.isFinite(n), `${what}: veio ${String(got)}`)
  assert(Math.abs(n - want) <= tol, `${what}: ${n} ≠ ${want} (±${tol})`)
}

export async function connect(url: string): Promise<pg.Client> {
  assert(url, 'URL do banco vazia (rode pelo `make smoke`)')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  return client
}

/**
 * Roda `fn` numa transação que sempre volta atrás: a fixture nunca fica no
 * banco de dev, passe ou falhe.
 */
export async function inRollback<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    return await fn()
  } finally {
    await client.query('rollback')
  }
}

/** Espera `sql` falhar com permission denied (42501), num savepoint. */
export async function denied(client: pg.Client, sql: string, params: unknown[] = []) {
  await client.query('savepoint denied')
  try {
    await client.query(sql, params)
  } catch (err) {
    await client.query('rollback to savepoint denied')
    const code = (err as { code?: string }).code
    assert(code === '42501', `esperava permission denied, veio ${code}: ${(err as Error).message}`)
    return
  }
  await client.query('rollback to savepoint denied')
  throw new Error(`passou, mas devia ser negado: ${sql}`)
}

export function finish(): never {
  console.log(failures === 0 ? '\ntudo certo' : `\n${failures} falha(s)`)
  process.exit(failures === 0 ? 0 : 1)
}
