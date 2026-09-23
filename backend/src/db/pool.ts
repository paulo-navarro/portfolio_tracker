import pg from 'pg'
import { config } from '../config.ts'

// `numeric` sai do pg como string e continua string até a tela: saldo não
// passa por float. É o default do driver; está aqui para ninguém "consertar".
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v)

/** Um pool por processo. Um usuário, uma coleta a cada 15 min: 5 sobra. */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
})

// Cliente ocioso que morre (Postgres reiniciou) emite 'error' no pool. Sem
// este handler o Node derruba o processo por evento não tratado.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message)
})

export function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params)
}

/** Usado pelo /api/health. Nunca lança. */
export async function ping(): Promise<boolean> {
  try {
    await pool.query('select 1')
    return true
  } catch {
    return false
  }
}

/** Pool, client de transação ou client avulso: tudo que sabe fazer `query`. */
export type Db = Pick<pg.PoolClient, 'query'>

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    // Se o rollback também falhar (conexão morta), o erro original é o que interessa.
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
