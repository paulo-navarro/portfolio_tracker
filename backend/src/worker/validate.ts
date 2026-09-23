/**
 * Conta nova (ou chave trocada) chega `pending`. Aqui ela vira `active`,
 * `rejected` ou, se a corretora não responder depois de N tentativas, `error`.
 * Nunca ativa na dúvida, e chave reprovada tem o ciphertext apagado na hora.
 */
import { config } from '../config.ts'
import { openCredentials } from '../sealing.ts'
import type { WorkerDeps } from './deps.ts'
import { classifyError, errorMessage } from './exchanges/index.ts'
import type { Kind, PermissionCheck } from './exchanges/types.ts'

interface PendingRow {
  id: string
  kind: Kind
  label: string
  sealed_credentials: Uint8Array | null
  exchange_uid: string | null
  attempts: number
}

export async function validatePending(d: WorkerDeps): Promise<void> {
  const { rows } = await d.db.query<PendingRow>(
    `select id, kind, label, sealed_credentials, exchange_uid, attempts
       from account
      where status = 'pending' and removed_at is null and kind <> 'manual'
      order by created_at`,
  )
  for (const row of rows) await validateOne(d, row)
}

async function reject(d: WorkerDeps, a: PendingRow, reason: string, perm?: PermissionCheck) {
  await d.db.query(
    `update account
        set status = 'rejected', status_reason = $2, sealed_credentials = null,
            permissions = coalesce($3, permissions), ip_restricted = coalesce($4, ip_restricted),
            checked_at = now()
      where id = $1`,
    [a.id, reason, perm ? JSON.stringify(perm.raw) : null, perm?.ipRestricted ?? null],
  )
  d.log(`account ${a.label} (${a.kind}) rejected: ${reason}`)
}

async function validateOne(d: WorkerDeps, a: PendingRow): Promise<void> {
  if (!a.sealed_credentials) return reject(d, a, 'a chave não chegou; cadastre de novo.')

  let creds
  try {
    creds = await openCredentials(a.sealed_credentials, d.keys)
  } catch (err) {
    return reject(d, a, errorMessage(err))
  }

  const exchange = d.exchanges(a.kind, creds)
  try {
    const perm = await exchange.checkPermissions()
    if (!perm.readOnly) return reject(d, a, perm.reason ?? 'essa chave pode mais que ler.', perm)

    const uid = await exchange.fetchUid()
    // Trocar a chave exige a mesma conta: chave de outra conta misturaria históricos.
    if (a.exchange_uid && a.exchange_uid !== uid) {
      return reject(d, a, 'essa chave é de outra conta da corretora. Use uma chave da mesma conta.', perm)
    }
    const dup = await d.db.query(
      `select 1 from account where kind = $1 and exchange_uid = $2 and removed_at is null and id <> $3`,
      [a.kind, uid, a.id],
    )
    if (dup.rowCount) return reject(d, a, 'essa conta da corretora já está cadastrada.', perm)

    // Uma leitura de saldo de verdade antes de ativar.
    await exchange.fetchBalances()

    try {
      await d.db.query(
        `update account
            set status = 'active', status_reason = null, exchange_uid = $2, permissions = $3,
                ip_restricted = $4, attempts = 0, checked_at = now()
          where id = $1`,
        [a.id, uid, JSON.stringify(perm.raw), perm.ipRestricted],
      )
    } catch (err) {
      // Outra conta com o mesmo uid entrou entre a checagem e o update.
      if ((err as { code?: string }).code === '23505') return reject(d, a, 'essa conta da corretora já está cadastrada.', perm)
      throw err
    }
    d.log(`account ${a.label} (${a.kind}) active`)
  } catch (err) {
    if (classifyError(err) === 'auth') {
      return reject(d, a, `a corretora recusou a chave (${errorMessage(err)}). Confira se copiou a chave e a secret inteiras e se a chave não foi apagada lá.`)
    }

    const attempts = a.attempts + 1
    if (attempts >= config.pendingMaxAttempts) {
      await d.db.query(
        `update account
            set status = 'error', attempts = $2, sealed_credentials = null, checked_at = now(),
                status_reason = 'não consegui falar com a corretora depois de várias tentativas; cadastre a chave de novo.'
          where id = $1`,
        [a.id, attempts],
      )
      d.log(`account ${a.label} (${a.kind}) gave up after ${attempts} attempts: ${errorMessage(err)}`)
      return
    }
    await d.db.query(`update account set attempts = $2, status_reason = $3 where id = $1`, [
      a.id,
      attempts,
      `tentando falar com a corretora (${attempts}/${config.pendingMaxAttempts})`,
    ])
    d.log(`account ${a.label} (${a.kind}) still pending (${attempts}): ${errorMessage(err)}`)
  }
}
