import type { FastifyInstance } from 'fastify'
import { config } from '../config.ts'
import { query } from '../db/pool.ts'
import { requireUser } from './auth.ts'

// Sinal de vida a cada minuto; três sem sinal é worker parado.
const WORKER_DEAD_AFTER_S = 180

export async function metaRoutes(app: FastifyInstance) {
  app.get('/api/meta', { preHandler: requireUser }, async () => {
    const { rows } = await query<{
      seen_age: number | null
      last_cycle_at: Date | null
      last_error: string | null
      last_run_at: Date | null
    }>(
      `select extract(epoch from now() - w.seen_at)::int as seen_age, w.last_cycle_at, w.last_error,
              (select finished_at from v_latest_run) as last_run_at
         from (select 1) one left join worker_status w on true`,
    )
    const r = rows[0]
    return {
      workerAlive: r.seen_age !== null && r.seen_age < WORKER_DEAD_AFTER_S,
      lastRunAt: r.last_run_at,
      lastCycleAt: r.last_cycle_at,
      lastError: r.last_error,
      collectIntervalMin: config.collectIntervalMin,
      egressIp: config.egressIp || null,
    }
  })
}
