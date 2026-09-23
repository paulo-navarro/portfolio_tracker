/**
 * Login com Google (authorization code + PKCE) e sessão no banco.
 *
 * O fluxo do Google vem do tarot. A sessão não: lá o cookie é um JWT, porque
 * não há nada para revogar. Aqui "sair de todos os dispositivos" é requisito,
 * então o cookie carrega um token aleatório e o banco guarda só o sha256 dele.
 *
 * A identidade é o `sub` do Google, não o e-mail: o e-mail só decide se entra.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.ts'
import { query } from '../db/pool.ts'
import { HttpError } from './http.ts'

const SESSION_TTL_DAYS = 30
// last_seen_at e expires_at só são regravados se a última vez for mais antiga
// que isso: não é um UPDATE por requisição.
const TOUCH_AFTER_MS = 60 * 60 * 1000

/** `__Host-` exige Secure, Path=/ e nenhum Domain: só vale em https. */
export const SESSION_COOKIE = config.secureCookies ? '__Host-session' : 'session'
const OAUTH_COOKIE = config.secureCookies ? '__Host-oauth' : 'oauth'

const COOKIE = { path: '/', httpOnly: true, secure: config.secureCookies, sameSite: 'lax' } as const

export interface SessionUser {
  id: string
  email: string
  name: string | null
  tokenHash: Buffer
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest()

/** O preHandler das rotas autenticadas. 401 sem sessão válida. */
export async function requireUser(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) throw new HttpError(401, 'entre para continuar.')
  const hash = hashToken(token)
  const { rows } = await query<{ id: string; email: string; name: string | null; last_seen_at: Date }>(
    `select u.id, u.email, u.name, s.last_seen_at
       from session s join app_user u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hash],
  )
  const row = rows[0]
  if (!row) throw new HttpError(401, 'sua sessão expirou; entre de novo.')
  // O e-mail saiu da lista depois do login: a sessão morre junto.
  if (!isAllowed(row.email)) {
    await query(`delete from session where token_hash = $1`, [hash])
    throw new HttpError(401, 'esse e-mail não tem mais acesso.')
  }
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_AFTER_MS) {
    await query(
      `update session set last_seen_at = now(), expires_at = now() + make_interval(days => $2) where token_hash = $1`,
      [hash, SESSION_TTL_DAYS],
    )
  }
  request.user = { id: row.id, email: row.email, name: row.name, tokenHash: hash }
}

function isAllowed(email: string): boolean {
  if (config.devLogin && email === 'dev@localhost') return true
  return config.allowedEmails.includes(email.toLowerCase())
}

async function startSession(request: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = b64url(randomBytes(32))
  await query(
    `insert into session (token_hash, user_id, expires_at, user_agent)
     values ($1, $2, now() + make_interval(days => $3), $4)`,
    [hashToken(token), userId, SESSION_TTL_DAYS, String(request.headers['user-agent'] ?? '').slice(0, 300)],
  )
  // O cookie dura mais que a sessão: quem manda na validade é o banco (30
  // dias sem uso). 400 dias é o teto dos navegadores.
  reply.setCookie(SESSION_COOKIE, token, { ...COOKIE, maxAge: 400 * 24 * 60 * 60 })
}

async function upsertUser(sub: string, email: string, name: string | null): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `insert into app_user (google_sub, email, name, last_login_at) values ($1, $2, $3, now())
     on conflict (google_sub) do update set email = excluded.email, name = excluded.name, last_login_at = now()
     returning id`,
    [sub, email, name],
  )
  return rows[0].id
}

interface GoogleUserInfo {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
}

export async function authRoutes(app: FastifyInstance) {
  const loginLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }

  // Pública: a tela de entrada decide quais botões mostrar.
  app.get('/api/auth/options', async () => ({ google: Boolean(config.googleClientId), dev: config.devLogin }))

  app.get('/api/auth/google', loginLimit, async (_request, reply) => {
    if (!config.googleClientId) return reply.redirect('/?error=google_not_configured')
    const state = b64url(randomBytes(16))
    const verifier = b64url(randomBytes(32))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: config.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
    return reply
      .setCookie(OAUTH_COOKIE, `${state}.${verifier}`, { ...COOKIE, maxAge: 10 * 60 })
      .redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  })

  app.get('/api/auth/google/callback', loginLimit, async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string }
    const [expectedState, verifier] = (request.cookies[OAUTH_COOKIE] ?? '').split('.')
    reply.clearCookie(OAUTH_COOKIE, COOKIE)

    if (!code) return reply.redirect('/?error=missing_code')
    if (!state || !expectedState || state !== expectedState || !verifier) return reply.redirect('/?error=bad_state')

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: config.googleRedirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      })
      if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`)
      const { access_token } = (await tokenRes.json()) as { access_token: string }

      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      if (!infoRes.ok) throw new Error(`userinfo failed: ${infoRes.status}`)
      const info = (await infoRes.json()) as GoogleUserInfo
      const email = info.email?.toLowerCase()

      // A lista casa string: sem e-mail verificado, um endereço que não é da
      // pessoa passaria por ela como se fosse.
      if (!email || info.email_verified !== true) return reply.redirect('/?error=email_not_verified')
      if (!isAllowed(email)) {
        request.log.warn('sign-in blocked by ALLOWED_EMAILS')
        return reply.redirect('/?error=not_allowed')
      }

      const userId = await upsertUser(info.sub, email, info.name ?? null)
      await startSession(request, reply, userId)
      return reply.redirect('/')
    } catch (err) {
      request.log.error(err, 'google callback failed')
      return reply.redirect('/?error=auth_failed')
    }
  })

  // Entrar sem Google, só em dev (o assertApiConfig recusa em prod). Entra como
  // `dev:local`, o usuário do `make seal-account`.
  if (config.devLogin) {
    app.get('/api/auth/dev', loginLimit, async (request, reply) => {
      const userId = await upsertUser('dev:local', 'dev@localhost', 'Dev')
      await startSession(request, reply, userId)
      return reply.redirect('/')
    })
  }

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await query(`delete from session where token_hash = $1`, [hashToken(token)])
    return reply.clearCookie(SESSION_COOKIE, COOKIE).code(204).send()
  })

  app.get('/api/sessions', { preHandler: requireUser }, async (request) => {
    const { rows } = await query<{ token_hash: Buffer; created_at: Date; last_seen_at: Date; user_agent: string | null }>(
      `select token_hash, created_at, last_seen_at, user_agent from session
        where user_id = $1 and expires_at > now() order by last_seen_at desc`,
      [request.user!.id],
    )
    return rows.map((r) => ({
      // O hash identifica a sessão sem revelar o token.
      id: b64url(r.token_hash).slice(0, 12),
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      userAgent: r.user_agent,
      current: r.token_hash.equals(request.user!.tokenHash),
    }))
  })

  // Sair de todos os dispositivos, inclusive este.
  app.delete('/api/sessions', { preHandler: requireUser }, async (request, reply) => {
    await query(`delete from session where user_id = $1`, [request.user!.id])
    return reply.clearCookie(SESSION_COOKIE, COOKIE).code(204).send()
  })
}
