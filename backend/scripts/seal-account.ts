/**
 * Cadastra uma conta de corretora no dev, fazendo exatamente o que o navegador
 * e a api vão fazer (fases 3 e 5): sela a chave com a chave pública, calcula o
 * fingerprint, grava como `pending` com o role app_api e manda o NOTIFY.
 *
 *   make seal-account KIND=binance LABEL=Binance
 *
 * A conta vai para o portfólio "Principal" do usuário de dev (google_sub
 * 'dev:local'), que o DEV_LOGIN da fase 3 também usa.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { sealCredentials } from '../src/sealing.ts'
import { connect, env } from './lib.ts'

const kind = process.env.KIND
const label = (process.env.LABEL ?? kind ?? '').trim()
const apiKey = (process.env.APIKEY ?? '').trim()
const secret = (process.env.SECRET ?? '').trim()
const passphrase = (process.env.PASSPHRASE ?? '').trim() || undefined

if (kind !== 'binance' && kind !== 'okx') throw new Error('KIND tem que ser binance ou okx')
if (!apiKey || !secret) throw new Error('API key e secret são obrigatórios')
if (kind === 'okx' && !passphrase) throw new Error('a OKX exige a passphrase')

const publicKey = new Uint8Array(Buffer.from(readFileSync(process.env.SEALING_PUBLIC_KEY_FILE ?? '', 'utf8').trim(), 'base64'))
const sealed = await sealCredentials({ apiKey, secret, passphrase }, publicKey)
const fingerprint = createHash('sha256').update(apiKey).digest()

const db = await connect(env.apiUrl)
try {
  await db.query('begin')
  const user = await db.query<{ id: string }>(
    `insert into app_user (google_sub, email, name) values ('dev:local', 'dev@localhost', 'Dev')
     on conflict (google_sub) do update set google_sub = excluded.google_sub
     returning id`,
  )
  const userId = user.rows[0].id
  let portfolio = await db.query<{ id: string }>(
    `select p.id from portfolio p join portfolio_member m on m.portfolio_id = p.id
      where m.user_id = $1 and p.name = 'Principal' and p.archived_at is null`,
    [userId],
  )
  if (portfolio.rowCount === 0) {
    portfolio = await db.query<{ id: string }>(`insert into portfolio (name) values ('Principal') returning id`)
    await db.query(`insert into portfolio_member (portfolio_id, user_id, role) values ($1, $2, 'owner')`, [portfolio.rows[0].id, userId])
  }
  const account = await db.query<{ id: string }>(
    `insert into account (portfolio_id, kind, label, sealed_credentials, key_fingerprint, key_hint, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [portfolio.rows[0].id, kind, label, Buffer.from(sealed), fingerprint, apiKey.slice(-4), userId],
  )
  // Entregue no commit: o worker só acorda com a conta já visível.
  await db.query('notify account_pending')
  await db.query('commit')
  console.log(`conta ${label} (${kind}, …${apiKey.slice(-4)}) cadastrada como pending: ${account.rows[0].id}`)
  console.log('acompanhe com `make logs`; a validação roda em segundos.')
} catch (err) {
  await db.query('rollback').catch(() => {})
  if ((err as { code?: string }).code === '23505') {
    console.error('essa chave já está cadastrada.')
    process.exit(1)
  }
  throw err
} finally {
  await db.end()
}
