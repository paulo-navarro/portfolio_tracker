/**
 * Contas. A credencial chega selada pelo navegador (crypto_box_seal com a
 * chave pública do worker) e a api só a guarda: o role dela nem consegue ler
 * a coluna de volta. Quem valida é o worker, acordado pelo NOTIFY.
 */
import type { FastifyInstance } from 'fastify'
import { query, withTransaction } from '../db/pool.ts'
import { requireUser } from './auth.ts'
import { camel, HttpError, noContent, requireAccount, requireMember } from './http.ts'

// Nunca sealed_credentials: o app_api não tem SELECT nela, e `select *` falharia.
const ACCOUNT = `id, kind, label, status, status_reason, key_hint, ip_restricted, checked_at, created_at,
                 (select max(finished_at) from run r join account_sync s on s.run_id = r.id
                   where s.account_id = account.id and s.ok and r.status = 'ok') as last_sync_at`

// crypto_box_seal acrescenta 48 bytes ao JSON {apiKey, secret, passphrase}.
const SEALED = { type: 'string', pattern: '^[A-Za-z0-9+/]+={0,2}$', minLength: 100, maxLength: 4096 }
const FINGERPRINT = { type: 'string', pattern: '^[0-9a-f]{64}$' }
const HINT = { type: 'string', pattern: '^[\\x21-\\x7e]{4}$' }

const TICKER = '^[A-Z0-9]{1,20}$'
const AMOUNT = '^\\d{1,20}(\\.\\d{1,18})?$'

function sealedBytes(b64: string): Buffer {
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 48 + 20) throw new HttpError(400, 'a chave selada veio curta demais.')
  return buf
}

function duplicate(err: unknown): never {
  if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'essa chave já está cadastrada.')
  throw err
}

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/api/portfolios/:id/accounts', async (request) => {
    const { id } = request.params as { id: string }
    await requireMember(request.user!.id, id)
    const { rows } = await query(`select ${ACCOUNT} from account where portfolio_id = $1 and removed_at is null order by created_at`, [id])
    return rows.map(camel)
  })

  app.post(
    '/api/portfolios/:id/accounts',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['kind', 'label'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['binance', 'okx', 'manual'] },
            label: { type: 'string', minLength: 1, maxLength: 40 },
            sealed: SEALED,
            fingerprint: FINGERPRINT,
            hint: HINT,
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      await requireMember(request.user!.id, id, 'owner')
      const b = request.body as { kind: string; label: string; sealed?: string; fingerprint?: string; hint?: string }

      if (b.kind === 'manual') {
        if (b.sealed || b.fingerprint || b.hint) throw new HttpError(400, 'conta manual não tem chave.')
        const { rows } = await query<{ id: string }>(
          `insert into account (portfolio_id, kind, label, status, created_by) values ($1, 'manual', $2, 'active', $3) returning id`,
          [id, b.label.trim(), request.user!.id],
        )
        return reply.code(201).send({ id: rows[0].id })
      }

      if (!b.sealed || !b.fingerprint || !b.hint) throw new HttpError(400, 'faltou a chave selada.')
      const sealed = sealedBytes(b.sealed)
      const fingerprint = Buffer.from(b.fingerprint, 'hex')
      const hint = b.hint
      const accountId = await withTransaction(async (db) => {
        const { rows } = await db
          .query<{ id: string }>(
            `insert into account (portfolio_id, kind, label, sealed_credentials, key_fingerprint, key_hint, created_by)
             values ($1, $2, $3, $4, $5, $6, $7) returning id`,
            [id, b.kind, b.label.trim(), sealed, fingerprint, hint, request.user!.id],
          )
          .catch(duplicate)
        // Entregue no commit: o worker acorda com a conta já visível.
        await db.query(`notify account_pending`)
        return rows[0].id
      })
      return reply.code(201).send({ id: accountId })
    },
  )

  // Trocar a chave: volta para pending. O worker exige que seja da mesma conta
  // na corretora, para não misturar históricos.
  app.put(
    '/api/accounts/:id/credentials',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['sealed', 'fingerprint', 'hint'],
          additionalProperties: false,
          properties: { sealed: SEALED, fingerprint: FINGERPRINT, hint: HINT },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const account = await requireAccount(request.user!.id, id, 'owner')
      if (account.kind === 'manual') throw new HttpError(400, 'conta manual não tem chave.')
      const b = request.body as { sealed: string; fingerprint: string; hint: string }
      await withTransaction(async (db) => {
        await db
          .query(
            `update account
                set sealed_credentials = $2, key_fingerprint = $3, key_hint = $4,
                    status = 'pending', status_reason = null, attempts = 0
              where id = $1`,
            [id, sealedBytes(b.sealed), Buffer.from(b.fingerprint, 'hex'), b.hint],
          )
          .catch(duplicate)
        await db.query(`notify account_pending`)
      })
      return noContent(reply)
    },
  )

  // Remove: apaga o ciphertext, o histórico fica. Revogar na corretora é com a pessoa.
  app.delete('/api/accounts/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    await requireAccount(request.user!.id, id, 'owner')
    await query(`update account set removed_at = now(), sealed_credentials = null where id = $1`, [id])
    return noContent(reply)
  })

  app.get('/api/accounts/:id/holdings', async (request) => {
    const { id } = request.params as { id: string }
    const account = await requireAccount(request.user!.id, id)
    if (account.kind !== 'manual') throw new HttpError(400, 'só conta manual tem posições digitadas.')
    const { rows } = await query(`select ticker, amount, note, updated_at from manual_holding where account_id = $1 order by ticker`, [id])
    return rows.map(camel)
  })

  // Substitui a lista inteira. A coleta seguinte (pedida aqui) leva para o total.
  app.put(
    '/api/accounts/:id/holdings',
    {
      schema: {
        body: {
          type: 'array',
          maxItems: 200,
          items: {
            type: 'object',
            required: ['ticker', 'amount'],
            additionalProperties: false,
            properties: {
              ticker: { type: 'string', pattern: TICKER },
              amount: { type: 'string', pattern: AMOUNT },
              note: { type: ['string', 'null'], maxLength: 200 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const account = await requireAccount(request.user!.id, id, 'owner')
      if (account.kind !== 'manual') throw new HttpError(400, 'só conta manual tem posições digitadas.')
      const items = request.body as { ticker: string; amount: string; note?: string | null }[]
      if (new Set(items.map((i) => i.ticker)).size !== items.length) throw new HttpError(400, 'o mesmo ativo apareceu duas vezes.')
      await withTransaction(async (db) => {
        await db.query(`delete from manual_holding where account_id = $1`, [id])
        for (const i of items) {
          await db.query(`insert into manual_holding (account_id, ticker, amount, note) values ($1, $2, $3, $4)`, [
            id,
            i.ticker,
            i.amount,
            i.note ?? null,
          ])
        }
        await db.query(`notify collect_now`)
      })
      return noContent(reply)
    },
  )
}
