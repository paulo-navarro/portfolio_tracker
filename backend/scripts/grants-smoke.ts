/**
 * Fase 1 — a api consegue gravar a credencial, mas não lê-la?
 *
 *   make smoke
 *
 * Monta uma conta com credencial como dono e confere o que cada role consegue,
 * com `set local role`. Tudo numa transação que volta atrás.
 */
import { createPortfolio, createUser } from './fixture.ts'
import { assert, check, connect, denied, env, finish, inRollback } from './lib.ts'

console.log('grants smoke\n')

const db = await connect(env.ownerUrl)

await inRollback(db, async () => {
  const userId = await createUser(db, `grants-${crypto.randomUUID()}`)
  const portfolioId = await createPortfolio(db, userId, 'Grants', null)
  const { rows } = await db.query<{ id: string }>(
    `insert into account (portfolio_id, kind, label, created_by, sealed_credentials, key_fingerprint, key_hint)
     values ($1, 'binance', 'Binance', $2, '\\xdeadbeef', '\\x01', 'a1b2') returning id`,
    [portfolioId, userId],
  )
  const accountId = rows[0].id

  await db.query('set local role app_api')

  await check('app_api não lê sealed_credentials', async () => {
    await denied(db, `select sealed_credentials from account where id = $1`, [accountId])
    await denied(db, `select * from account where id = $1`, [accountId])
  })

  await check('app_api lê o resto da conta', async () => {
    const { rows } = await db.query(`select label, key_hint, status from account where id = $1`, [accountId])
    assert(rows[0].key_hint === 'a1b2', `veio ${JSON.stringify(rows[0])}`)
  })

  await check('app_api grava e apaga a credencial (trocar chave, remover conta)', async () => {
    await db.query(`update account set sealed_credentials = '\\xcafe', status = 'pending' where id = $1`, [accountId])
    await db.query(`update account set sealed_credentials = null, removed_at = now() where id = $1`, [accountId])
    await denied(db, `update account set sealed_credentials = '\\x00' where id = $1 returning *`, [accountId])
  })

  await check('app_api não mexe no que é do worker', async () => {
    await denied(db, `update account set permissions = '{}' where id = $1`, [accountId])
    await denied(db, `update account set exchange_uid = 'x' where id = $1`, [accountId])
    await denied(db, `insert into run default values`)
    await denied(db, `insert into asset (ticker) values ('BTC')`)
    await denied(db, `delete from balance`)
  })

  await check('app_api lê as views', async () => {
    await db.query(`select * from v_portfolio_summary where portfolio_id = $1`, [portfolioId])
    await db.query(`select * from v_position limit 1`)
  })

  await db.query('reset role')
  await db.query(`update account set sealed_credentials = '\\xdeadbeef', removed_at = null where id = $1`, [accountId])
  await db.query('set local role app_worker')

  await check('app_worker lê sealed_credentials', async () => {
    const { rows } = await db.query<{ hex: string }>(`select encode(sealed_credentials, 'hex') as hex from account where id = $1`, [
      accountId,
    ])
    assert(rows[0].hex === 'deadbeef', `veio ${rows[0].hex}`)
  })

  await check('app_worker não mexe em usuário nem sessão', async () => {
    await denied(db, `insert into app_user (google_sub, email) values ('x', 'x@example.com')`)
    await denied(db, `select * from session`)
    await denied(db, `insert into portfolio (name) values ('x')`)
  })
})

await check('as senhas dos roles de verdade funcionam (conexão real como app_api)', async () => {
  const api = await connect(env.apiUrl)
  try {
    await inRollback(api, () => denied(api, `select sealed_credentials from account limit 1`))
  } finally {
    await api.end()
  }
})

await db.end()
finish()
