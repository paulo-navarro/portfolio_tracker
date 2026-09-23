import { readFile } from 'node:fs/promises'
import sodium from 'libsodium-wrappers'
import type { Credentials } from './worker/exchanges/types.ts'

export interface SealingKeys {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

/**
 * Lê o par X25519 do worker e confere que a privada gera a pública que foi
 * para o build do frontend. Par trocado quer dizer que tudo que o navegador
 * selar vai ser ilegível: melhor não subir.
 *
 * Os arquivos são base64 dos 32 bytes crus (scripts/keys.ts).
 */
export async function loadSealingKeys(privateFile: string, publicFile: string): Promise<SealingKeys> {
  await sodium.ready
  const privateKey = await readKey(privateFile, 'private')
  const publicKey = await readKey(publicFile, 'public')

  const derived = sodium.crypto_scalarmult_base(privateKey)
  if (!sodium.memcmp(derived, publicKey)) {
    throw new Error(`sealing key pair mismatch: ${privateFile} does not belong to ${publicFile}`)
  }
  return { publicKey, privateKey }
}

async function readKey(file: string, kind: string): Promise<Uint8Array> {
  if (!file) throw new Error(`sealing ${kind} key file not configured`)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const hint = code === 'EACCES' ? ' (the container runs as uid 1000: chown 1000:1000 the key file)' : ' (run `make keys`)'
    throw new Error(`cannot read sealing ${kind} key ${file}: ${code ?? err}${hint}`)
  }
  const key = Buffer.from(text.trim(), 'base64')
  if (key.length !== 32) throw new Error(`sealing ${kind} key ${file} must be 32 bytes, got ${key.length}`)
  return new Uint8Array(key)
}

/**
 * Abre a credencial selada pelo navegador: JSON {apiKey, secret, passphrase?}.
 * Lança se a caixa não abrir (selada com outra chave pública) ou se o conteúdo
 * não tiver a forma esperada.
 */
export async function openCredentials(sealed: Uint8Array, keys: SealingKeys): Promise<Credentials> {
  await sodium.ready
  let plain: string
  try {
    plain = sodium.to_string(sodium.crypto_box_seal_open(sealed, keys.publicKey, keys.privateKey))
  } catch {
    throw new SealError('não consegui abrir a chave: foi selada com outra chave pública')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(plain)
  } catch {
    throw new SealError('a chave selada não é JSON')
  }
  const c = parsed as Record<string, unknown>
  if (typeof c.apiKey !== 'string' || typeof c.secret !== 'string' || !c.apiKey || !c.secret) {
    throw new SealError('a chave selada não tem apiKey e secret')
  }
  if (c.passphrase !== undefined && typeof c.passphrase !== 'string') throw new SealError('passphrase inválida')
  return { apiKey: c.apiKey, secret: c.secret, passphrase: c.passphrase as string | undefined }
}

/** Sela como o navegador vai selar (fase 5). Usado pelo seal-account e pelos smokes. */
export async function sealCredentials(creds: Credentials, publicKey: Uint8Array): Promise<Uint8Array> {
  await sodium.ready
  return sodium.crypto_box_seal(sodium.from_string(JSON.stringify(creds)), publicKey)
}

export class SealError extends Error {}
