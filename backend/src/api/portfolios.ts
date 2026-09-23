/**
 * Portfólios e o que a planilha mostrava. A api só lê as views e filtra por
 * membro; conta nenhuma é feita aqui.
 */
import type { FastifyInstance } from 'fastify'
import { config } from '../config.ts'
import { query, withTransaction } from '../db/pool.ts'
import { requireUser } from './auth.ts'
import { camel, noContent, requireMember } from './http.ts'

const DECIMAL = '^\\d{1,15}(\\.\\d{1,2})?$'

const RANGES: Record<string, string | null> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '1y': '1 year', all: null }

// Colunas de v_portfolio_summary (sempre com o alias `s`) que vão para a tela.
const SUMMARY = `s.portfolio_id as id, s.name, s.invested_brl, s.as_of, s.usd_brl, s.value_usd, s.value_brl,
                 s.value_at_ath_usd, s.value_at_ath_brl, s.ath_multiple, s.chg_24h, s.chg_7d, s.result_pct,
                 s.unpriced::int as unpriced, s.stale`

export async function portfolioRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/api/me', async (request) => {
    const u = request.user!
    const { rows } = await query(
      `select p.id, p.name, m.role from portfolio p join portfolio_member m on m.portfolio_id = p.id
        where m.user_id = $1 and p.archived_at is null order by p.created_at`,
      [u.id],
    )
    return { user: { id: u.id, email: u.email, name: u.name }, portfolios: rows }
  })

  // Início: os portfólios com os totais da coleta mais recente.
  app.get('/api/portfolios', async (request) => {
    const { rows } = await query(
      `select ${SUMMARY}, m.role
         from v_portfolio_summary s join portfolio_member m on m.portfolio_id = s.portfolio_id
        where m.user_id = $1 and s.archived_at is null
        order by s.name`,
      [request.user!.id],
    )
    return rows.map(camel)
  })

  app.post(
    '/api/portfolios',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            investedBrl: { type: ['string', 'null'], pattern: DECIMAL },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, investedBrl } = request.body as { name: string; investedBrl?: string | null }
      const id = await withTransaction(async (db) => {
        const { rows } = await db.query<{ id: string }>(`insert into portfolio (name, invested_brl) values ($1, $2) returning id`, [
          name.trim(),
          investedBrl ?? null,
        ])
        await db.query(`insert into portfolio_member (portfolio_id, user_id, role) values ($1, $2, 'owner')`, [rows[0].id, request.user!.id])
        return rows[0].id
      })
      return reply.code(201).send({ id })
    },
  )

  app.patch(
    '/api/portfolios/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            investedBrl: { type: ['string', 'null'], pattern: DECIMAL },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      await requireMember(request.user!.id, id, 'owner')
      const body = request.body as { name?: string; investedBrl?: string | null }
      await query(
        `update portfolio
            set name = coalesce($2, name),
                invested_brl = case when $3 then $4::numeric else invested_brl end
          where id = $1`,
        [id, body.name?.trim() ?? null, 'investedBrl' in body, body.investedBrl ?? null],
      )
      return noContent(reply)
    },
  )

  // Arquiva: some das listas, o histórico fica.
  app.delete('/api/portfolios/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    await requireMember(request.user!.id, id, 'owner')
    await query(`update portfolio set archived_at = now() where id = $1 and archived_at is null`, [id])
    return noContent(reply)
  })

  app.get('/api/portfolios/:id/summary', async (request) => {
    const { id } = request.params as { id: string }
    const role = await requireMember(request.user!.id, id)
    // O investido calculado vem ao lado do informado, nunca no lugar dele.
    // `investedCalcMissing`: contas de corretora ativas cujo histórico de reais
    // não entra na conta (a OKX, por enquanto, ou uma busca que ainda não rodou).
    const { rows } = await query(
      `select ${SUMMARY},
              i.invested_calc_brl, i.deposits::int as invested_calc_deposits, i.withdrawals::int as invested_calc_withdrawals,
              i.first_at as invested_calc_since,
              (s.value_brl / nullif(i.invested_calc_brl, 0) - 1) * 100 as result_calc_pct,
              (select count(*)::int from account a
                where a.portfolio_id = s.portfolio_id and a.kind <> 'manual' and a.status = 'active'
                  and a.removed_at is null and a.fiat_synced_at is null) as invested_calc_missing
         from v_portfolio_summary s
         left join v_portfolio_invested i on i.portfolio_id = s.portfolio_id
        where s.portfolio_id = $1`,
      [id],
    )
    return { ...camel(rows[0]), role }
  })

  // As colunas da planilha, maior valor primeiro. Abaixo de HIDE_BELOW_USD
  // fica de fora (a alocação continua contando com elas, como na planilha);
  // sem cotação aparece, com os valores vazios.
  app.get('/api/portfolios/:id/positions', async (request) => {
    const { id } = request.params as { id: string }
    await requireMember(request.user!.id, id)
    const { rows } = await query(
      `select ticker, qty, price_usd, ath_usd, pct_below_ath, pct_above_ath, value_usd, value_at_ath_usd, value_at_ath_brl,
              allocation_pct, price_brl, value_brl, chg_24h, chg_7d, stale
         from v_position
        where portfolio_id = $1 and (value_usd is null or value_usd >= $2)
        order by value_usd desc nulls last, ticker`,
      [id, config.hideBelowUsd],
    )
    return rows.map(camel)
  })

  // Onde está: por conta e carteira.
  app.get('/api/portfolios/:id/sources', async (request) => {
    const { id } = request.params as { id: string }
    await requireMember(request.user!.id, id)
    const { rows } = await query(
      `select account_id, kind, label, wallet, ticker, amount, value_usd, value_brl, stale
         from v_position_source
        where portfolio_id = $1
        order by label, value_usd desc nulls last, ticker`,
      [id],
    )
    return rows.map(camel)
  })

  // Um ponto por dia.
  app.get(
    '/api/portfolios/:id/history',
    { schema: { querystring: { type: 'object', properties: { range: { type: 'string', enum: Object.keys(RANGES) } } } } },
    async (request) => {
      const { id } = request.params as { id: string }
      const { range = '30d' } = request.query as { range?: string }
      await requireMember(request.user!.id, id)
      const since = RANGES[range]
      const { rows } = await query(
        `select day::text, value_usd, value_brl from v_portfolio_history
          where portfolio_id = $1 and ($2::interval is null or day >= (now() at time zone 'America/Sao_Paulo')::date - $2::interval)
          order by day`,
        [id, since],
      )
      return rows.map(camel)
    },
  )
}

