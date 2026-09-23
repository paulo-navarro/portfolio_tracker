import type { ReactNode } from 'react'
import { ago, dateTime } from '../lib/format.ts'
import { useOnline } from '../lib/offline.ts'
import { useMeta } from '../lib/queries.ts'
import { Link } from '../lib/router.tsx'

/** Barra de cima: marca (ou voltar), última coleta e Ajustes. */
export function Shell({ back, title, children }: { back?: { to: string; label: string }; title?: string; children: ReactNode }) {
  const meta = useMeta()
  const online = useOnline()
  const m = meta.data
  const collected = m?.lastRunAt ? `coleta ${ago(m.lastRunAt)}` : 'sem coleta ainda'
  const warn = m && (!m.workerAlive || m.lastError)

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          {back ? (
            <Link to={back.to} className="back" aria-label={`voltar para ${back.label}`}>
              <span aria-hidden>‹</span> {back.label}
            </Link>
          ) : (
            <Link to="/" className="brand">
              Cripto
            </Link>
          )}
        </div>
        {title && <div className="topbar-title">{title}</div>}
        <div className="topbar-right">
          <span className={`sync ${warn ? 'sync-warn' : ''}`} title={m?.lastError ?? undefined}>
            {warn && !m?.workerAlive ? 'coleta parada' : collected}
          </span>
          <Link to="/ajustes" className="icon-btn" aria-label="Ajustes">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path
                fill="currentColor"
                d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Zm7.43-2.53a7.8 7.8 0 0 0 0-1.94l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.68-.97l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.6.24-1.17.57-1.68.97l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65a7.8 7.8 0 0 0 0 1.94l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.39.3.61.22l2.49-1c.51.4 1.08.73 1.68.97l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.6-.24 1.17-.57 1.68-.97l2.49 1c.22.08.48 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65Z"
              />
            </svg>
          </Link>
        </div>
      </header>
      {!online && (
        <div className="offline-bar" role="status">
          <span aria-hidden>⚡</span> Sem conexão. Mostrando o último dado{m?.lastRunAt ? ` (coleta de ${dateTime(m.lastRunAt)})` : ''}; nada pode ser alterado agora.
        </div>
      )}
      <main className="content">{children}</main>
    </div>
  )
}
