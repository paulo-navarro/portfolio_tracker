import { useState, type FormEvent } from 'react'
import { seal, type Sealed } from '../../lib/seal.ts'
import { ErrorBox } from '../ui.tsx'

/**
 * Os campos da chave (api key, secret e, na OKX, passphrase). Sela no
 * navegador e entrega só o selado para quem chamou: o texto da chave morre
 * aqui dentro.
 */
export function KeyForm({
  kind,
  submitLabel,
  withLabel,
  onSealed,
  onCancel,
}: {
  kind: 'binance' | 'okx'
  submitLabel: string
  withLabel?: boolean
  onSealed: (sealed: Sealed, label: string) => Promise<unknown>
  onCancel?: () => void
}) {
  const [label, setLabel] = useState(kind === 'binance' ? 'Binance' : 'OKX')
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const sealed = await seal({ apiKey: apiKey.trim(), secret: secret.trim(), passphrase: kind === 'okx' ? passphrase : undefined })
      await onSealed(sealed, label.trim())
      // Não guarda a chave nem depois de enviar.
      setApiKey('')
      setSecret('')
      setPassphrase('')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const noAutofill = { autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false } as const

  return (
    <form className="key-form" onSubmit={(e) => void submit(e)}>
      {withLabel && (
        <label className="field">
          <span>Nome da conta</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} required />
        </label>
      )}
      <label className="field">
        <span>API key</span>
        <input className="mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required minLength={8} {...noAutofill} />
      </label>
      <label className="field">
        <span>Secret key</span>
        <input className="mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} required minLength={8} {...noAutofill} autoComplete="new-password" />
      </label>
      {kind === 'okx' && (
        <label className="field">
          <span>Passphrase (a que você criou junto com a chave)</span>
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required {...noAutofill} autoComplete="new-password" />
        </label>
      )}
      <p className="fine seal-note">
        <span aria-hidden>🔒</span> A chave é selada aqui no seu navegador. O servidor guarda só o selado e não consegue ler; só a coleta abre.
      </p>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'selando…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            cancelar
          </button>
        )}
      </div>
      {error !== null && <ErrorBox error={error} />}
    </form>
  )
}
