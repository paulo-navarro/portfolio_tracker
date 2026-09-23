/**
 * Fase 3 — a api entrega cada coisa só para quem pode?
 *
 *   make smoke
 *
 * Por HTTP, contra a api de dev de verdade. A api grava (não dá para
 * desfazer numa transação), então o smoke cria usuários `smoke:*` e apaga tudo
 * no fim, passe ou falhe.
 *
 * Os usuários do smoke têm o e-mail `dev@localhost`, o que o DEV_LOGIN deixa
 * entrar: o smoke precisa do dev com DEV_LOGIN ligado (o default).
 */
import { createHash, randomBytes } from 'node:crypto'
import { assert, check, connect, env, finish } from './lib.ts'

console.log('api smoke\n')

const BASE = env.apiBase
const ORIGIN = BASE // em dev a api confere o Origin contra o Host
const CYCLE_LOCK = 7_331_001

type Res = { status: number; body: any; headers: Headers }

async function http(method: string, path: string, opts: { cookie?: string; body?: unknown; origin?: string | null } = {}): Promise<Res> {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = `session=${opts.cookie}`
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const origin = opts.origin === undefined ? ORIGIN : opts.origin
  if (origin && method !== 'GET') headers.origin = origin
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, body, headers: res.headers }
}

function expect(res: Res, status: number, what: string) {
  assert(res.status === status, `${what}: HTTP ${res.status} ${JSON.stringify(res.body)} (queria ${status})`)
}

const db = await connect(env.ownerUrl)
const tag = `smoke:${randomBytes(4).toString('hex')}`

async function user(name: string, email = 'dev@localhost') {
  const { rows } = await db.query<{ id: string }>(`insert into app_user (google_sub, email, name) values ($1, $2, $3) returning id`, [
    `${tag}:${name}`,
    email,
    name,
  ])
  return { id: rows[0].id, cookie: await session(rows[0].id) }
}

async function session(userId: string) {
  const token = randomBytes(32).toString('base64url')
  await db.query(`insert into session (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 day')`, [
    createHash('sha256').update(token).digest(),
    userId,
  ])
  return token
}

let smokeRun: string | null = null

// Segura o lock da coleta do começo ao fim: o worker de verdade não coleta as
// contas do smoke (gravar posição manual pede uma coleta), e não vê a coleta
// do smoke como "a mais recente" de todo mundo.
await db.query('select pg_advisory_lock($1)', [CYCLE_LOCK])

try {
  const a = await user('A')
  const b = await user('B')

  await check('sem sessão: 401 com frase', async () => {
    const r = await http('GET', '/api/me')
    expect(r, 401, '/api/me')
    assert(r.body.error === 'entre para continuar.', JSON.stringify(r.body))
  })

  await check('DEV_LOGIN: entra como dev:local e o cookie é HttpOnly', async () => {
    const r = await http('GET', '/api/auth/dev')
    expect(r, 302, '/api/auth/dev')
    const set = r.headers.get('set-cookie') ?? ''
    assert(/session=[^;]+;.*HttpOnly/i.test(set) && /SameSite=Lax/i.test(set), set)
    const cookie = set.match(/session=([^;]+)/)![1]
    const me = await http('GET', '/api/me', { cookie })
    expect(me, 200, '/api/me')
    assert(me.body.user.email === 'dev@localhost', JSON.stringify(me.body))
    expect(await http('POST', '/api/auth/logout', { cookie }), 204, 'logout')
    expect(await http('GET', '/api/me', { cookie }), 401, 'depois do logout')
  })

  let pid = ''
  await check('criar portfólio: quem cria é owner', async () => {
    const r = await http('POST', '/api/portfolios', { cookie: a.cookie, body: { name: 'Principal', investedBrl: '12000.00' } })
    expect(r, 201, 'POST /api/portfolios')
    pid = r.body.id
    const me = await http('GET', '/api/me', { cookie: a.cookie })
    assert(me.body.portfolios.some((p: any) => p.id === pid && p.role === 'owner'), JSON.stringify(me.body))
  })

  await check('escrita sem Origin, ou de outra origem: 403', async () => {
    expect(await http('POST', '/api/portfolios', { cookie: a.cookie, body: { name: 'x' }, origin: null }), 403, 'sem Origin')
    expect(await http('POST', '/api/portfolios', { cookie: a.cookie, body: { name: 'x' }, origin: 'https://evil.example' }), 403, 'Origin errado')
    expect(await http('DELETE', `/api/portfolios/${pid}`, { cookie: a.cookie, origin: 'https://evil.example' }), 403, 'DELETE de fora')
  })

  await check('B não vê nem mexe no portfólio de A: 404, como se não existisse', async () => {
    for (const path of ['summary', 'positions', 'sources', 'history', 'accounts']) {
      expect(await http('GET', `/api/portfolios/${pid}/${path}`, { cookie: b.cookie }), 404, path)
    }
    expect(await http('PATCH', `/api/portfolios/${pid}`, { cookie: b.cookie, body: { name: 'meu' } }), 404, 'PATCH')
    expect(await http('DELETE', `/api/portfolios/${pid}`, { cookie: b.cookie }), 404, 'DELETE')
    const list = await http('GET', '/api/portfolios', { cookie: b.cookie })
    assert(!list.body.some((p: any) => p.id === pid), 'apareceu na lista de B')
  })

  await check('viewer lê, mas não escreve (403)', async () => {
    await db.query(`insert into portfolio_member (portfolio_id, user_id, role) values ($1, $2, 'viewer')`, [pid, b.id])
    const s = await http('GET', `/api/portfolios/${pid}/summary`, { cookie: b.cookie })
    expect(s, 200, 'summary')
    assert(s.body.role === 'viewer', JSON.stringify(s.body))
    expect(await http('PATCH', `/api/portfolios/${pid}`, { cookie: b.cookie, body: { name: 'meu' } }), 403, 'PATCH')
    expect(await http('POST', `/api/portfolios/${pid}/accounts`, { cookie: b.cookie, body: { kind: 'manual', label: 'x' } }), 403, 'conta')
  })

  await check('PATCH: investido muda, e número inválido é 400 com frase', async () => {
    expect(await http('PATCH', `/api/portfolios/${pid}`, { cookie: a.cookie, body: { investedBrl: '20000.50' } }), 204, 'PATCH')
    const s = await http('GET', `/api/portfolios/${pid}/summary`, { cookie: a.cookie })
    assert(s.body.investedBrl === '20000.50' && s.body.name === 'Principal', JSON.stringify(s.body))
    const bad = await http('PATCH', `/api/portfolios/${pid}`, { cookie: a.cookie, body: { investedBrl: '1,5' } })
    expect(bad, 400, 'vírgula')
    assert(bad.body.error === 'algum campo veio num formato que não dá para usar.' && bad.body.field === 'investedBrl', JSON.stringify(bad.body))
  })

  await check('id que não é uuid é 404, não 500', async () => {
    expect(await http('GET', '/api/portfolios/nao-e-uuid/summary', { cookie: a.cookie }), 404, 'summary')
    expect(await http('DELETE', '/api/accounts/1', { cookie: a.cookie }), 404, 'account')
  })

  let manualId = ''
  let binanceId = ''
  const sealed = randomBytes(160).toString('base64')
  const fingerprint = randomBytes(32).toString('hex')

  await check('conta manual e posições digitadas', async () => {
    const r = await http('POST', `/api/portfolios/${pid}/accounts`, { cookie: a.cookie, body: { kind: 'manual', label: 'Ledger' } })
    expect(r, 201, 'POST manual')
    manualId = r.body.id
    expect(
      await http('PUT', `/api/accounts/${manualId}/holdings`, {
        cookie: a.cookie,
        body: [
          { ticker: 'BTC', amount: '0.125', note: 'ledger' },
          { ticker: 'HBAR', amount: '1500.5' },
        ],
      }),
      204,
      'PUT holdings',
    )
    const h = await http('GET', `/api/accounts/${manualId}/holdings`, { cookie: a.cookie })
    assert(h.body.map((x: any) => `${x.ticker}=${x.amount}`).join() === 'BTC=0.125,HBAR=1500.5', JSON.stringify(h.body))
    const dup = await http('PUT', `/api/accounts/${manualId}/holdings`, {
      cookie: a.cookie,
      body: [
        { ticker: 'BTC', amount: '1' },
        { ticker: 'BTC', amount: '2' },
      ],
    })
    expect(dup, 400, 'ticker repetido')
    expect(await http('PUT', `/api/accounts/${manualId}/holdings`, { cookie: a.cookie, body: [{ ticker: 'btc', amount: '1' }] }), 400, 'minúscula')
  })

  await check('conta de corretora: entra pending, e a chave nunca volta', async () => {
    const r = await http('POST', `/api/portfolios/${pid}/accounts`, {
      cookie: a.cookie,
      body: { kind: 'binance', label: 'Binance', sealed, fingerprint, hint: 'a1b2' },
    })
    expect(r, 201, 'POST binance')
    binanceId = r.body.id
    const list = await http('GET', `/api/portfolios/${pid}/accounts`, { cookie: a.cookie })
    const acc = list.body.find((x: any) => x.id === binanceId)
    assert(acc && acc.keyHint === 'a1b2' && ['pending', 'rejected'].includes(acc.status), JSON.stringify(acc))
    const text = JSON.stringify(list.body)
    assert(!/sealed|fingerprint/i.test(text) && !text.includes(sealed.slice(0, 20)), 'a resposta vaza a credencial')
  })

  await check('a mesma chave duas vezes: 409 com frase', async () => {
    const r = await http('POST', `/api/portfolios/${pid}/accounts`, {
      cookie: a.cookie,
      body: { kind: 'okx', label: 'OKX', sealed, fingerprint, hint: 'a1b2' },
    })
    expect(r, 409, 'duplicada')
    assert(r.body.error === 'essa chave já está cadastrada.', JSON.stringify(r.body))
  })

  await check('trocar a chave volta para pending; conta manual não tem chave', async () => {
    const r = await http('PUT', `/api/accounts/${binanceId}/credentials`, {
      cookie: a.cookie,
      body: { sealed: randomBytes(160).toString('base64'), fingerprint: randomBytes(32).toString('hex'), hint: 'c3d4' },
    })
    expect(r, 204, 'PUT credentials')
    const { rows } = await db.query(`select key_hint, attempts from account where id = $1`, [binanceId])
    assert(rows[0].key_hint === 'c3d4' && rows[0].attempts === 0, JSON.stringify(rows[0]))
    const m = await http('PUT', `/api/accounts/${manualId}/credentials`, {
      cookie: a.cookie,
      body: { sealed, fingerprint: randomBytes(32).toString('hex'), hint: 'zzzz' },
    })
    expect(m, 400, 'manual')
  })

  await check('chave selada malformada: 400', async () => {
    const r = await http('POST', `/api/portfolios/${pid}/accounts`, {
      cookie: a.cookie,
      body: { kind: 'binance', label: 'x', sealed: 'não é base64!', fingerprint, hint: 'a1b2' },
    })
    expect(r, 400, 'sealed inválido')
  })

  await check('posições, onde está e histórico, com uma coleta', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into run (started_at, finished_at, status, usd_brl) values (now(), now(), 'ok', '5.1059') returning id`,
    )
    smokeRun = rows[0].id
    await db.query(`insert into account_sync (run_id, account_id, ok) values ($1, $2, true)`, [smokeRun, manualId])
    await db.query(
      `insert into balance (run_id, account_id, ticker, wallet, amount)
       values ($1, $2, 'BTC', 'manual', '0.125'), ($1, $2, 'HBAR', 'manual', '1500.5'), ($1, $2, 'DUST', 'manual', '1')`,
      [smokeRun, manualId],
    )
    await db.query(
      `insert into quote (run_id, ticker, price_usd, chg_24h, chg_7d, source)
       values ($1, 'BTC', '85906', '6.1', '8.56', 'binance'), ($1, 'HBAR', '0.09082', '6.21', null, 'binance'),
              ($1, 'DUST', '0.01', '0', '0', 'binance')`,
      [smokeRun],
    )

    const p = await http('GET', `/api/portfolios/${pid}/positions`, { cookie: a.cookie })
    expect(p, 200, 'positions')
    // DUST vale US$ 0,01: abaixo de HIDE_BELOW_USD, fica de fora. A ordem é por
    // valor, maior primeiro.
    assert(p.body.map((x: any) => x.ticker).join() === 'BTC,HBAR', p.body.map((x: any) => x.ticker).join())
    assert(p.body[0].qty === '0.125' && typeof p.body[0].valueBrl === 'string', JSON.stringify(p.body[0]))
    // Ativo sem 7d na coleta vem com o campo vazio, não com erro.
    const hbar = p.body.find((x: any) => x.ticker === 'HBAR')
    assert(hbar.chg7d === null && hbar.qty === '1500.5', JSON.stringify(hbar))

    const s = await http('GET', `/api/portfolios/${pid}/sources`, { cookie: a.cookie })
    assert(s.body.length === 3 && s.body[0].label === 'Ledger', JSON.stringify(s.body))

    const sum = await http('GET', `/api/portfolios/${pid}/summary`, { cookie: a.cookie })
    assert(Number(sum.body.valueUsd) > 10_000 && sum.body.stale === false && sum.body.role === 'owner' && sum.body.unpriced === 0, JSON.stringify(sum.body))

    const h = await http('GET', `/api/portfolios/${pid}/history?range=7d`, { cookie: a.cookie })
    assert(h.body.length === 1 && h.body[0].valueUsd === sum.body.valueUsd, JSON.stringify(h.body))
    expect(await http('GET', `/api/portfolios/${pid}/history?range=2w`, { cookie: a.cookie }), 400, 'range inválido')
  })

  await check('remover conta: some da lista, o ciphertext some do banco', async () => {
    expect(await http('DELETE', `/api/accounts/${binanceId}`, { cookie: a.cookie }), 204, 'DELETE')
    const list = await http('GET', `/api/portfolios/${pid}/accounts`, { cookie: a.cookie })
    assert(!list.body.some((x: any) => x.id === binanceId), 'continuou na lista')
    const { rows } = await db.query(`select sealed_credentials is null as wiped, removed_at is not null as removed from account where id = $1`, [
      binanceId,
    ])
    assert(rows[0].wiped && rows[0].removed, JSON.stringify(rows[0]))
    expect(await http('DELETE', `/api/accounts/${binanceId}`, { cookie: a.cookie }), 404, 'remover de novo')
  })

  await check('sessões: lista com a atual marcada; sair de todos derruba o outro aparelho', async () => {
    const other = await session(a.id)
    const list = await http('GET', '/api/sessions', { cookie: a.cookie })
    assert(list.body.length === 2 && list.body.filter((s: any) => s.current).length === 1, JSON.stringify(list.body))
    expect(await http('DELETE', '/api/sessions', { cookie: other }), 204, 'sair de todos')
    expect(await http('GET', '/api/me', { cookie: a.cookie }), 401, 'o outro aparelho')
    expect(await http('GET', '/api/me', { cookie: other }), 401, 'este aparelho')
  })

  await check('e-mail fora da lista: a sessão morre na próxima requisição', async () => {
    const c = await user('C', 'intruso@example.com')
    const r = await http('GET', '/api/me', { cookie: c.cookie })
    expect(r, 401, '/api/me')
    const { rowCount } = await db.query(`select 1 from session where user_id = $1`, [c.id])
    assert(rowCount === 0, 'a sessão continuou no banco')
  })

  await check('arquivar tira da lista', async () => {
    const b2 = await session(b.id)
    expect(await http('DELETE', `/api/portfolios/${pid}`, { cookie: b2 }), 403, 'viewer arquivando')
    const a2 = await session(a.id)
    expect(await http('DELETE', `/api/portfolios/${pid}`, { cookie: a2 }), 204, 'owner arquivando')
    const list = await http('GET', '/api/portfolios', { cookie: a2 })
    assert(!list.body.some((p: any) => p.id === pid), 'continuou na lista')
  })

  await check('/api/meta: worker vivo', async () => {
    const c = await session(a.id)
    const r = await http('GET', '/api/meta', { cookie: c })
    expect(r, 200, 'meta')
    assert(r.body.workerAlive === true && r.body.collectIntervalMin > 0, JSON.stringify(r.body))
  })

  await check('rota que não existe: 404 em JSON', async () => {
    const r = await http('GET', '/api/nada')
    assert(r.status === 404 && r.body.error === 'não encontrado.', JSON.stringify(r.body))
  })
} finally {
  // Limpa tudo do smoke, na ordem das FKs.
  if (smokeRun) await db.query(`delete from run where id = $1`, [smokeRun])
  const users = `select id from app_user where google_sub like $1`
  const portfolios = `select portfolio_id from portfolio_member where user_id in (${users})`
  const accounts = `select id from account where portfolio_id in (${portfolios})`
  const like = [`${tag}:%`]
  await db.query(`delete from account_sync where account_id in (${accounts})`, like)
  await db.query(`delete from account where id in (${accounts})`, like)
  await db.query(`delete from portfolio where id in (${portfolios})`, like)
  await db.query(`delete from app_user where google_sub like $1`, like)
  await db.query(`delete from session where user_id = (select id from app_user where google_sub = 'dev:local')`)
  await db.query('select pg_advisory_unlock($1)', [CYCLE_LOCK])
  await db.end()
}

finish()
