import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type pg from 'pg'

// Vale em dev (src/db → /app/migrations) e em prod (dist/db → /app/migrations),
// desde que o Dockerfile copie migrations/ para a imagem.
const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations')

type Log = (msg: string) => void

/**
 * Aplica os .sql pendentes, em ordem de nome, cada um na sua transação.
 * Roda num serviço próprio (`migrate`), com o usuário dono: api e worker só
 * sobem depois que ele termina, e nenhum dos dois tem a senha do dono.
 */
export async function migrate(client: pg.Client, log: Log = console.log): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version    text        primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const { rows } = await client.query<{ version: string }>('select version from schema_migrations')
  const applied = new Set(rows.map((r) => r.version))

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const pending = files.filter((f) => !applied.has(f))

  if (pending.length === 0) {
    log(`nothing to migrate (${applied.size} already applied)`)
    return
  }

  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into schema_migrations (version) values ($1)', [file])
      await client.query('commit')
      log(`applied ${file}`)
    } catch (err) {
      await client.query('rollback')
      // Schema pela metade é pior que não subir: o migrate sai com erro e
      // api e worker não sobem.
      throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * Aplica as senhas dos roles de runtime, vindas do .env. Roda a cada boot:
 * trocar a senha no .env e subir de novo basta. Senha nunca vai para .sql.
 *
 * `alter role` não aceita parâmetro ($1); o `format(%L)` do próprio Postgres
 * faz o quoting.
 */
export async function syncRolePasswords(client: pg.Client, passwords: Record<string, string>, log: Log = console.log) {
  for (const [role, password] of Object.entries(passwords)) {
    const { rows } = await client.query<{ sql: string }>('select format($$alter role %I password %L$$, $1::text, $2::text) as sql', [
      role,
      password,
    ])
    await client.query(rows[0].sql)
    log(`password set for ${role}`)
  }
}
