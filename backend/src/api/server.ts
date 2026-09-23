import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyRequest } from 'fastify'
import { config } from '../config.ts'
import { ping } from '../db/pool.ts'
import { accountRoutes } from './accounts.ts'
import { authRoutes } from './auth.ts'
import { HttpError } from './http.ts'
import { metaRoutes } from './meta.ts'
import { portfolioRoutes } from './portfolios.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Escrita só da própria origem, além do SameSite=Lax do cookie. Em prod, o
 * Origin tem que ser exatamente CLIENT_ORIGIN. Em dev, basta bater com o Host
 * da requisição (o Vite preserva o Host), para funcionar em localhost e pelo
 * IP da LAN, no celular.
 */
function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin
  if (!origin) return false
  if (config.isProduction) return origin === config.clientOrigin
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

export async function buildServer() {
  const app = Fastify({
    logger: true,
    // Confia nos N proxies mais próximos (o IP do rate limit sai do
    // X-Forwarded-For contando daqui). Mesma semântica de `trustProxy: N`.
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
    bodyLimit: 64 * 1024,
  })

  await app.register(cookie)
  // Só as rotas que pedem (login, cadastro de conta) têm limite. Roda no
  // preHandler, depois da sessão: com usuário, conta por usuário; sem (login),
  // por IP.
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    keyGenerator: (request) => request.user?.id ?? request.ip,
    errorResponseBuilder: () => ({ statusCode: 429, error: 'muitas tentativas; espere um pouco e tente de novo.' }),
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!SAFE_METHODS.has(request.method) && !sameOrigin(request)) {
      return reply.code(403).send({ error: 'pedido de outra origem recusado.' })
    }
  })

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message })
    const e = err as { validation?: unknown; statusCode?: number; message: string }
    if (e.validation) {
      // O texto do validador ("body/investedBrl must match pattern…") não é
      // para gente. O campo vai junto, para quem estiver depurando.
      const field = (e.validation as { instancePath?: string }[])[0]?.instancePath?.replace(/^\//, '') || undefined
      return reply.code(400).send({ error: 'algum campo veio num formato que não dá para usar.', field })
    }
    if (e.statusCode === 429) return reply.code(429).send({ error: 'muitas tentativas; espere um pouco e tente de novo.' })
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message })
    request.log.error(err)
    return reply.code(500).send({ error: 'algo deu errado do nosso lado.' })
  })

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'não encontrado.' }))

  // 200 só com o banco respondendo: é o que o healthcheck do compose usa para
  // liberar o frontend-prod.
  app.get('/api/health', async (_req, reply) => {
    const db = await ping()
    return reply.code(db ? 200 : 503).send({ status: db ? 'ok' : 'degraded', db: db ? 'ok' : 'down' })
  })

  await app.register(authRoutes)
  await app.register(portfolioRoutes)
  await app.register(accountRoutes)
  await app.register(metaRoutes)

  return app
}
