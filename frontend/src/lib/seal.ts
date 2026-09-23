/**
 * Sela a credencial da corretora no navegador, antes de qualquer envio.
 *
 * crypto_box_seal com a chave pública do worker, que veio no build (nunca
 * buscada em runtime). Só o worker, com a privada, abre. A api guarda o
 * ciphertext sem conseguir ler, e a chave em claro nunca sai desta página.
 *
 * A libsodium é carregada só aqui, quando o formulário abre: o resto do app
 * não paga o peso dela.
 *
 * O fingerprint é sha256, igual ao do `make seal-account` (node:crypto), para
 * a trava de chave duplicada valer pelos dois caminhos. Vem do @noble/hashes:
 * a libsodium padrão não tem sha256 (só a "sumo", bem maior), e o WebCrypto só
 * existe em contexto seguro, então pelo IP da LAN não existiria.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export interface Credentials {
  apiKey: string
  secret: string
  passphrase?: string
}

export interface Sealed {
  /** base64 do crypto_box_seal do JSON {apiKey, secret, passphrase?}. */
  sealed: string
  /** sha256(apiKey) em hex: a api recusa a mesma chave duas vezes. */
  fingerprint: string
  /** Os 4 últimos caracteres da api key, para a pessoa reconhecer a chave. */
  hint: string
}

export function fingerprint(apiKey: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(apiKey)))
}

export async function seal(creds: Credentials): Promise<Sealed> {
  const { default: sodium } = await import('libsodium-wrappers')
  await sodium.ready
  const publicKey = sodium.from_base64(__SEALING_PUBLIC_KEY__, sodium.base64_variants.ORIGINAL)
  const payload: Credentials = { apiKey: creds.apiKey, secret: creds.secret }
  if (creds.passphrase) payload.passphrase = creds.passphrase
  const box = sodium.crypto_box_seal(sodium.from_string(JSON.stringify(payload)), publicKey)
  return {
    sealed: sodium.to_base64(box, sodium.base64_variants.ORIGINAL),
    fingerprint: fingerprint(creds.apiKey),
    hint: creds.apiKey.slice(-4),
  }
}
