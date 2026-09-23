import { Shell } from '../components/Shell.tsx'
import { ErrorBox, Section, Spinner } from '../components/ui.tsx'
import { ago } from '../lib/format.ts'
import { useLogout, useLogoutEverywhere, useMe, useSessions } from '../lib/queries.ts'

/** "Chrome no Android", "Safari no iPhone": o bastante para reconhecer o aparelho. */
function device(ua: string | null): string {
  if (!ua) return 'aparelho desconhecido'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador'
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} no ${os}` : browser
}

export function Settings() {
  const me = useMe()
  const sessions = useSessions()
  const logout = useLogout()
  const everywhere = useLogoutEverywhere()

  return (
    <Shell back={{ to: '/', label: 'Início' }} title="Ajustes">
      <Section title="Conta">
        <p className="muted">{me.data?.user.email}</p>
        <button className="btn btn-ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
          sair
        </button>
      </Section>

      <Section title="Aparelhos conectados">
        {sessions.isPending && <Spinner />}
        {sessions.error && <ErrorBox error={sessions.error} />}
        <ul className="sessions">
          {sessions.data?.map((s) => (
            <li key={s.id}>
              <span>
                {device(s.userAgent)}
                {s.current && <span className="chip chip-good">este</span>}
              </span>
              <span className="muted">usado {ago(s.lastSeenAt)}</span>
            </li>
          ))}
        </ul>
        <button className="btn btn-danger" onClick={() => everywhere.mutate()} disabled={everywhere.isPending}>
          sair de todos os aparelhos
        </button>
        {everywhere.error && <ErrorBox error={everywhere.error} />}
      </Section>
    </Shell>
  )
}
