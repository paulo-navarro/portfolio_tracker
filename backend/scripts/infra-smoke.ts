/**
 * Fase 0 — a infra está de pé?
 *
 *   make smoke
 */
import { assert, check, connect, env, finish } from './lib.ts'

console.log('infra smoke\n')

await check('/api/health', async () => {
  const res = await fetch(`${env.apiBase}/api/health`)
  const body = await res.text()
  assert(res.status === 200, `HTTP ${res.status} ${body}`)
  return body
})

const api = await connect(env.apiUrl)

await check('api conecta como app_api', async () => {
  const { rows } = await api.query<{ user: string; version: string }>(
    `select current_user as user, current_setting('server_version') as version`,
  )
  assert(rows[0].user === 'app_api', `conectou como ${rows[0].user}`)
  return `Postgres ${rows[0].version}`
})

await check('app_api não é dono de nada', async () => {
  const { rows } = await api.query<{ super: boolean; create: boolean }>(
    `select rolsuper as super, has_schema_privilege('public', 'create') as create from pg_roles where rolname = current_user`,
  )
  assert(!rows[0].super, 'app_api é superuser')
  assert(!rows[0].create, 'app_api pode criar tabela em public')
})

await check('worker vivo, com a chave de selagem certa', async () => {
  const { rows } = await api.query<{ age: number }>(`select extract(epoch from now() - seen_at)::int as age from worker_status`)
  assert(rows.length === 1, 'worker nunca gravou sinal de vida (confira `make logs`)')
  assert(rows[0].age < 120, `último sinal há ${rows[0].age}s`)
  return `último sinal há ${rows[0].age}s`
})

await api.end()
finish()
