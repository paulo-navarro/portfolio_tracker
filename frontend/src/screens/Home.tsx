import { useState, type FormEvent } from 'react'
import { Shell } from '../components/Shell.tsx'
import { Delta, ErrorBox, Notice, Spinner } from '../components/ui.tsx'
import { brl, usd } from '../lib/format.ts'
import { useCreatePortfolio, usePortfolios } from '../lib/queries.ts'
import { Link, navigate } from '../lib/router.tsx'

export function Home() {
  const portfolios = usePortfolios()
  const list = portfolios.data ?? []
  // Consolidado só dos portfólios em que sou dono. Uma conta de corretora entra
  // uma vez só no sistema, então somar portfólios não conta nada em dobro.
  const owned = list.filter((p) => p.role === 'owner' && p.valueBrl !== null)
  const totalBrl = owned.reduce((s, p) => s + Number(p.valueBrl), 0)
  const totalUsd = owned.reduce((s, p) => s + Number(p.valueUsd), 0)

  return (
    <Shell>
      {portfolios.isPending && <Spinner />}
      {portfolios.error && <ErrorBox error={portfolios.error} retry={() => void portfolios.refetch()} />}

      {portfolios.data && (
        <>
          {owned.length > 1 && (
            <section className="hero">
              <div className="hero-label">Total dos meus portfólios</div>
              <div className="hero-value">{brl(totalBrl)}</div>
              <div className="hero-sub">{usd(totalUsd)}</div>
            </section>
          )}

          <div className="portfolio-list">
            {list.map((p) => (
              <Link key={p.id} to={`/p/${p.id}`} className="portfolio-card">
                <div className="portfolio-card-top">
                  <span className="portfolio-name">{p.name}</span>
                  {p.role === 'viewer' && <span className="chip chip-info">só leitura</span>}
                  {p.stale && (
                    <span className="chip chip-warn" title="alguma conta falhou na última coleta; mostrando o último saldo bom">
                      <span aria-hidden>!</span> desatualizado
                    </span>
                  )}
                </div>
                <div className="portfolio-card-value">{p.valueBrl === null ? 'sem coleta ainda' : brl(p.valueBrl)}</div>
                {p.valueBrl !== null && (
                  <div className="portfolio-card-deltas">
                    <span>
                      24h <Delta value={p.chg24h} />
                    </span>
                    <span>
                      7d <Delta value={p.chg7d} />
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>

          {list.length === 0 && (
            <Notice icon="✦">
              <strong>Crie o primeiro portfólio.</strong> Depois é só cadastrar as contas das corretoras, com chave só de leitura.
            </Notice>
          )}

          <NewPortfolio first={list.length === 0} />
        </>
      )}
    </Shell>
  )
}

function NewPortfolio({ first }: { first: boolean }) {
  const [open, setOpen] = useState(first)
  const [name, setName] = useState(first ? 'Principal' : '')
  const create = useCreatePortfolio()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { id } = await create.mutateAsync({ name: name.trim() })
    navigate(`/p/${id}/contas`)
  }

  if (!open) {
    return (
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        + novo portfólio
      </button>
    )
  }
  return (
    <form className="inline-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Nome do portfólio</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={create.isPending || !name.trim()}>
          {create.isPending ? 'criando…' : 'criar'}
        </button>
        {!first && (
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            cancelar
          </button>
        )}
      </div>
      {create.error && <ErrorBox error={create.error} />}
    </form>
  )
}
