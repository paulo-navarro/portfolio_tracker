/**
 * Entrypoint do serviço `migrate`: aplica as migrations como dono do banco,
 * acerta as senhas dos roles e sai. Código diferente de 0 impede api e worker
 * de subirem (`service_completed_successfully` no compose).
 */
import pg from 'pg'
import { assertConfig, config } from './config.ts'
import { migrate, syncRolePasswords } from './db/migrate.ts'

const DEV_PASSWORDS = new Set(['cripto', 'criptoapidev', 'criptoworkerdev'])

// Os roles que o migrate acerta. O dono entra só na checagem: a senha dele é
// a do POSTGRES_PASSWORD, que o Postgres grava no primeiro boot do volume.
const passwords = {
  app_api: process.env.APP_API_PASSWORD ?? '',
  app_worker: process.env.APP_WORKER_PASSWORD ?? '',
}

function ownerPassword(): string {
  try {
    return decodeURIComponent(new URL(config.databaseUrl).password)
  } catch {
    return ''
  }
}

/** Em prod, nenhuma senha fraca sobe: nem a do dono, nem a dos roles. */
function problems(): string[] {
  const out: string[] = []
  for (const [role, pw] of Object.entries({ ...passwords, 'owner (POSTGRES_PASSWORD)': ownerPassword() })) {
    if (!pw) out.push(`password for ${role} is empty`)
    else if (!/^[A-Za-z0-9]+$/.test(pw)) out.push(`password for ${role} must be letters and digits only (it goes inside a URL)`)
    else if (config.isProduction && (DEV_PASSWORDS.has(pw) || pw.length < 32)) out.push(`password for ${role} must be at least 32 chars in production`)
  }
  return out
}

const log = (msg: string) => console.log(`[migrate] ${msg}`)

try {
  assertConfig(problems())
  const client = new pg.Client({ connectionString: config.databaseUrl })
  await client.connect()
  try {
    await migrate(client, log)
    await syncRolePasswords(client, passwords, log)
  } finally {
    await client.end()
  }
} catch (err) {
  console.error(`[migrate] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
