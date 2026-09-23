import { Allocation } from '../components/portfolio/Allocation.tsx'
import { Header } from '../components/portfolio/Header.tsx'
import { History } from '../components/portfolio/History.tsx'
import { Positions } from '../components/portfolio/Positions.tsx'
import { Sources } from '../components/portfolio/Sources.tsx'
import { Shell } from '../components/Shell.tsx'
import { ErrorBox, Notice, Section, Spinner } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { usePositions, useSources, useSummary } from '../lib/queries.ts'
import { Link } from '../lib/router.tsx'

export function Portfolio({ id }: { id: string }) {
  const summary = useSummary(id)
  const positions = usePositions(id)
  const sources = useSources(id)

  if (summary.error instanceof ApiError && summary.error.status === 404) return <NotFoundPortfolio />

  const s = summary.data
  const contas = (
    <Link to={`/p/${id}/contas`} className="btn btn-ghost btn-sm">
      contas
    </Link>
  )

  return (
    <Shell back={{ to: '/', label: 'Início' }}>
      {summary.isPending && <Spinner />}
      {summary.error && <ErrorBox error={summary.error} retry={() => void summary.refetch()} />}

      {s && s.valueBrl === null && (
        <>
          <section className="hero">
            <div className="hero-label">{s.name}</div>
            <div className="hero-value hero-empty">sem coleta ainda</div>
          </section>
          <Notice icon="✦">
            Cadastre uma conta da Binance ou da OKX (com chave só de leitura) ou uma posição manual.{' '}
            <Link to={`/p/${id}/contas`}>Ir para contas</Link>
          </Notice>
        </>
      )}

      {s && s.valueBrl !== null && (
        <div className="portfolio">
          <div className="portfolio-top">
            <Header s={s} />
            <Section title="Alocação" className="allocation-card">
              {positions.data && <Allocation positions={positions.data} />}
            </Section>
          </div>

          <Section title="Posições" action={contas}>
            {positions.isPending && <Spinner />}
            {positions.error && <ErrorBox error={positions.error} />}
            {positions.data && <Positions positions={positions.data} />}
          </Section>

          <Section title="Evolução">
            <History portfolioId={id} />
          </Section>

          <Section title="Onde está">
            {sources.error && <ErrorBox error={sources.error} />}
            {sources.data && <Sources sources={sources.data} />}
          </Section>
        </div>
      )}
    </Shell>
  )
}

export function NotFoundPortfolio() {
  return (
    <Shell back={{ to: '/', label: 'Início' }}>
      <Notice icon="?">Esse portfólio não existe, ou não é seu.</Notice>
    </Shell>
  )
}
