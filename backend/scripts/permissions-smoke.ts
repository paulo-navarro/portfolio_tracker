/**
 * Fase 2 — só chave de leitura passa?
 *
 *   make smoke
 *
 * As regras sobre as fixtures, e a validação de conta pendente de ponta a
 * ponta (selar, abrir, checar, ativar ou rejeitar) com corretoras falsas, como
 * app_worker, numa transação que volta atrás.
 */
import { config } from '../src/config.ts'
import { checkBinance, checkOkx } from '../src/worker/exchanges/permissions.ts'
import { validatePending } from '../src/worker/validate.ts'
import { createPortfolio, createUser } from './fixture.ts'
import { FakeExchanges, FakeMarket, fakeDeps, fixture, insertAccount, throwawayKeys } from './fakes.ts'
import { assert, check, connect, env, finish, inRollback } from './lib.ts'

console.log('permissions smoke\n')

await check('Binance: só leitura passa, e o IP vinculado é lido', async () => {
  const r = checkBinance(fixture('binance-restrictions-readonly'))
  assert(r.readOnly && r.ipRestricted, JSON.stringify(r))
})

await check('Binance: negociar e sacar reprovam, com frase para gente', async () => {
  const r = checkBinance(fixture('binance-restrictions-trade'))
  assert(!r.readOnly, 'passou')
  assert(r.reason === 'essa chave pode sacar, negociar. Crie outra só com leitura e revogue esta.', `${r.reason}`)
})

await check('Binance: flag desconhecida ligada reprova', async () => {
  const r = checkBinance(fixture('binance-restrictions-unknown-flag'))
  assert(!r.readOnly && r.reason?.includes('enableSomethingNew'), `${r.reason}`)
})

await check('Binance: sem leitura reprova', async () => {
  const r = checkBinance(fixture('binance-restrictions-no-reading'))
  assert(!r.readOnly && r.reason === 'essa chave não tem permissão de leitura.', `${r.reason}`)
})

await check('Binance: resposta vazia ou estranha reprova', async () => {
  for (const raw of [null, {}, 'oi', { enableReading: 'true' }]) assert(!checkBinance(raw).readOnly, JSON.stringify(raw))
})

await check('OKX: read_only passa; read_only,trade reprova; vazio reprova', async () => {
  assert(checkOkx(fixture('okx-config-readonly')).readOnly, 'read_only reprovou')
  assert(checkOkx(fixture('okx-config-readonly')).ipRestricted, 'ip não lido')
  const t = checkOkx(fixture('okx-config-trade'))
  assert(!t.readOnly && t.reason?.startsWith('essa chave pode negociar'), `${t.reason}`)
  assert(!checkOkx(fixture('okx-config-empty')).readOnly, 'perm vazia passou')
})

// ── Validação de ponta a ponta ──────────────────────

const db = await connect(env.ownerUrl)
const keys = await throwawayKeys()

await inRollback(db, async () => {
  const userId = await createUser(db, `perm-${crypto.randomUUID()}`)
  const portfolioId = await createPortfolio(db, userId, 'Perm', null)
  const ex = new FakeExchanges()
  const d = fakeDeps(db, keys, ex, new FakeMarket(), { now: new Date() })

  const add = (apiKey: string, kind: 'binance' | 'okx' = 'binance', extra: { status?: string; uid?: string } = {}) =>
    insertAccount(db, { portfolioId, userId, kind, apiKey, keys, ...extra })

  ex.behaviors.set('good', { uid: '111' })
  ex.behaviors.set('trade', { permissions: 'binance-restrictions-trade' })
  ex.behaviors.set('okxtrade', { permissions: 'okx-config-trade' })
  ex.behaviors.set('net', { error: 'network' })
  ex.behaviors.set('auth', { error: 'auth' })
  ex.behaviors.set('dup', { uid: '111' })
  ex.behaviors.set('swap', { uid: '999' })

  const ids = {
    good: await add('good'),
    trade: await add('trade'),
    okxtrade: await add('okxtrade', 'okx'),
    net: await add('net'),
    auth: await add('auth'),
    // Troca de chave de uma conta que já era 222: chave nova é de outra conta.
    swap: await add('swap', 'binance', { uid: '222' }),
  }

  await db.query('set local role app_worker')
  await validatePending(d)
  // `dup` entra depois que `good` já é a conta 111.
  await db.query('reset role')
  const dupId = await add('dup')
  await db.query('set local role app_worker')
  await validatePending(d)

  const status = async (id: string) =>
    (
      await db.query<{ status: string; status_reason: string | null; sealed: boolean; uid: string | null; attempts: number; perms: boolean }>(
        `select status, status_reason, sealed_credentials is not null as sealed, exchange_uid as uid, attempts,
                permissions is not null as perms
           from account where id = $1`,
        [id],
      )
    ).rows[0]

  await check('só leitura vira active, com uid e permissões gravados', async () => {
    const s = await status(ids.good)
    assert(s.status === 'active' && s.uid === '111' && s.sealed && s.perms, JSON.stringify(s))
  })

  await check('chave que negocia vira rejected e o ciphertext some na hora', async () => {
    for (const id of [ids.trade, ids.okxtrade]) {
      const s = await status(id)
      assert(s.status === 'rejected' && !s.sealed && s.status_reason?.includes('negociar'), JSON.stringify(s))
    }
  })

  await check('chave de leitura nunca leu saldo antes de passar pela checagem', async () => {
    assert(!ex.calls.includes('trade:balances'), ex.calls.join(', '))
  })

  await check('erro de rede mantém pending e conta a tentativa', async () => {
    const s = await status(ids.net)
    assert(s.status === 'pending' && s.sealed && s.attempts === 2, JSON.stringify(s))
  })

  await check(`depois de ${config.pendingMaxAttempts} tentativas vira error e apaga a chave`, async () => {
    for (let i = 0; i < config.pendingMaxAttempts; i++) await validatePending(d)
    const s = await status(ids.net)
    assert(s.status === 'error' && !s.sealed, JSON.stringify(s))
  })

  await check('chave recusada pela corretora vira rejected', async () => {
    const s = await status(ids.auth)
    assert(s.status === 'rejected' && !s.sealed && s.status_reason?.startsWith('a corretora recusou a chave (') && s.status_reason.includes('Confira'), JSON.stringify(s))
  })

  await check('a mesma conta da corretora com outra chave é recusada', async () => {
    const s = await status(dupId)
    assert(s.status === 'rejected' && s.status_reason === 'essa conta da corretora já está cadastrada.', JSON.stringify(s))
  })

  await check('trocar a chave por uma de outra conta é recusado', async () => {
    const s = await status(ids.swap)
    assert(s.status === 'rejected' && s.uid === '222' && s.status_reason?.startsWith('essa chave é de outra conta'), JSON.stringify(s))
  })

  await check('chave selada com outra chave pública é recusada', async () => {
    await db.query('reset role')
    const other = await throwawayKeys()
    const id = await insertAccount(db, { portfolioId, userId, kind: 'binance', apiKey: 'good2', keys: other })
    await db.query('set local role app_worker')
    await validatePending(d)
    const s = await status(id)
    assert(s.status === 'rejected' && !s.sealed && s.status_reason?.includes('outra chave pública'), JSON.stringify(s))
  })
})

await db.end()
finish()
