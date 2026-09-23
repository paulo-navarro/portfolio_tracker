import type { ReactNode } from 'react'
import type { AccountStatus } from '../lib/api.ts'
import { signedPct, trend } from '../lib/format.ts'

/** Variação com sinal e cor. O sinal carrega o sentido; a cor só reforça. */
export function Delta({ value, digits = 2, className = '' }: { value: string | number | null | undefined; digits?: number; className?: string }) {
  return <span className={`delta ${trend(value)} ${className}`}>{signedPct(value, digits)}</span>
}

/**
 * Barra do preço até o ATH: a trilha inteira é o ATH, o preenchimento é onde o
 * preço está. É o elemento que identifica o app.
 *
 * Preço acima do topo anterior: a barra enche e fica sólida — é o momento em
 * que o ativo está no ATH, e o rótulo ao lado diz quanto passou.
 */
export function AthBar({ pctBelowAth, atAth }: { pctBelowAth: string | null; atAth?: boolean }) {
  const below = pctBelowAth === null ? null : Math.min(100, Math.max(0, Number(pctBelowAth)))
  const fill = below === null ? 0 : 100 - below
  const label = below === null ? 'sem ATH' : atAth ? 'no ATH' : `a ${below.toFixed(1)}% abaixo do ATH`
  return (
    <div className={`ath-bar ${atAth ? 'is-ath' : ''}`} role="img" aria-label={label}>
      <div className="ath-fill" style={{ width: `${fill}%` }} />
    </div>
  )
}

export function Spinner({ label = 'carregando…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <span>{error instanceof Error ? error.message : 'algo deu errado.'}</span>
      {retry && (
        <button className="btn btn-ghost btn-sm" onClick={retry}>
          tentar de novo
        </button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'error'; icon?: string; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`}>
      {icon && (
        <span className="notice-icon" aria-hidden>
          {icon}
        </span>
      )}
      <div>{children}</div>
    </div>
  )
}

const STATUS: Record<AccountStatus, { label: string; icon: string; tone: string }> = {
  active: { label: 'ativa', icon: '●', tone: 'good' },
  pending: { label: 'validando', icon: '◌', tone: 'info' },
  rejected: { label: 'recusada', icon: '✕', tone: 'bad' },
  blocked: { label: 'bloqueada', icon: '■', tone: 'bad' },
  error: { label: 'sem resposta', icon: '!', tone: 'warn' },
}

/** Status com ícone e palavra: a cor nunca carrega o sentido sozinha. */
export function StatusChip({ status }: { status: AccountStatus }) {
  const s = STATUS[status]
  return (
    <span className={`chip chip-${s.tone}`}>
      <span aria-hidden>{s.icon}</span> {s.label}
    </span>
  )
}

export function Section({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}
