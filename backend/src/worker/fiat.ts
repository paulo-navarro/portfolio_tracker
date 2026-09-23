/**
 * Histórico de reais (PIX, TED) de cada conta de corretora, para o investido
 * calculado. Não roda a cada coleta: essas rotas da Binance são caras em cota.
 *
 * Primeira vez: desde a abertura da Binance (jul/2017). Depois, uma vez por
 * dia, só os últimos 7 dias (pega pedido que terminou depois de aparecer).
 * Repetir janela não duplica: a chave é conta + número do pedido.
 */
import { openCredentials } from '../sealing.ts'
import type { WorkerDeps } from './deps.ts'
import { errorMessage } from './exchanges/index.ts'
import type { Kind } from './exchanges/types.ts'

export const FIAT_START = new Date('2017-07-01T00:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const OVERLAP_MS = 7 * DAY_MS

interface Row {
  id: string
  kind: Kind
  label: string
  sealed_credentials: Uint8Array
  fiat_synced_at: Date | null
}

export async function syncFiat(d: WorkerDeps): Promise<void> {
  const now = d.now()
  const { rows } = await d.db.query<Row>(
    `select id, kind, label, sealed_credentials, fiat_synced_at
       from account
      where kind <> 'manual' and status = 'active' and removed_at is null and sealed_credentials is not null
        and (fiat_synced_at is null or fiat_synced_at < $1)
      order by created_at`,
    [new Date(now.getTime() - DAY_MS)],
  )

  for (const a of rows) {
    const since = a.fiat_synced_at ? new Date(a.fiat_synced_at.getTime() - OVERLAP_MS) : FIAT_START
    try {
      const exchange = d.exchanges(a.kind, await openCredentials(a.sealed_credentials, d.keys))
      const flows = await exchange.fetchFiatFlows(since)
      // Corretora sem isso implementado: fica sem data, e a tela diz que não conta.
      if (flows === null) continue

      let added = 0
      await d.tx(async (db) => {
        for (const f of flows) {
          const res = await db.query(
            `insert into fiat_flow (account_id, external_id, direction, currency, amount, fee, method, at)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (account_id, external_id) do nothing`,
            [a.id, f.externalId, f.direction, f.currency, f.amount, f.fee, f.method, f.at],
          )
          added += res.rowCount ?? 0
        }
        await db.query(`update account set fiat_synced_at = $2 where id = $1`, [a.id, now])
      })
      d.log(`fiat ${a.label} (${a.kind}): ${flows.length} since ${since.toISOString().slice(0, 10)}, ${added} new`)
    } catch (err) {
      // Falhou: tenta de novo na próxima coleta (a data não mudou).
      d.log(`fiat ${a.label} (${a.kind}) failed: ${errorMessage(err)}`)
    }
  }
}
