import { useAuthOptions } from '../lib/queries.ts'

// O que o callback do Google devolve em ?error=.
const ERRORS: Record<string, string> = {
  not_allowed: 'Esse e-mail não tem acesso. Peça para quem cuida do app incluir você.',
  email_not_verified: 'Esse e-mail não está verificado no Google.',
  bad_state: 'O login expirou no meio do caminho. Tente de novo.',
  missing_code: 'O Google não completou o login. Tente de novo.',
  google_not_configured: 'O login com Google ainda não foi configurado neste servidor.',
  auth_failed: 'Não deu para entrar agora. Tente de novo em instantes.',
}

export function Login() {
  const options = useAuthOptions()
  const error = new URLSearchParams(window.location.search).get('error')

  return (
    <main className="login">
      <div className="login-card">
        <h1 className="brand brand-lg">Cripto</h1>
        <p className="lede">A planilha, sem digitar nada.</p>

        {error && (
          <div className="notice notice-error" role="alert">
            {ERRORS[error] ?? 'Não deu para entrar. Tente de novo.'}
          </div>
        )}

        <div className="login-actions">
          {options.data?.google !== false && (
            <a className="btn btn-primary btn-block" href="/api/auth/google">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12Z" />
              </svg>
              Entrar com Google
            </a>
          )}
          {options.data?.dev && (
            <a className="btn btn-ghost btn-block" href="/api/auth/dev">
              Entrar como dev
            </a>
          )}
        </div>
        <p className="fine">Só leitura: o app nunca movimenta nada nas corretoras.</p>
      </div>
    </main>
  )
}
