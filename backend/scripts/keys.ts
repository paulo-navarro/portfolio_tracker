/**
 * Gera o par de chaves de selagem (X25519) de cada ambiente.
 *
 *   make keys
 *
 * Roda com o node puro (sem npm install): X25519 cru é exatamente o formato
 * de chave do crypto_box_seal da libsodium.
 *
 *   keys/sealing.<env>.pub     pública, vai para o build do frontend (no git)
 *   secrets/sealing.<env>.key  privada, só o worker monta (fora do git, 600)
 *
 * Nunca sobrescreve: trocar o par deixa ilegível toda chave de corretora já
 * cadastrada naquele ambiente. Para trocar de propósito, apague os dois arquivos.
 */
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

for (const env of ['dev', 'prod']) {
  const pubFile = `keys/sealing.${env}.pub`
  const keyFile = `secrets/sealing.${env}.key`

  if (existsSync(pubFile) || existsSync(keyFile)) {
    console.log(`${env}: já existe, nada a fazer`)
    continue
  }

  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64')
  const key = Buffer.from(privateKey.export({ format: 'jwk' }).d!, 'base64url').toString('base64')

  mkdirSync('keys', { recursive: true })
  mkdirSync('secrets', { recursive: true, mode: 0o700 })
  writeFileSync(keyFile, key + '\n', { mode: 0o600 })
  writeFileSync(pubFile, pub + '\n')
  console.log(`${env}: ${pubFile} + ${keyFile}`)
}
