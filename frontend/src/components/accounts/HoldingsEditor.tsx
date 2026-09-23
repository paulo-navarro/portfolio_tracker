import { useEffect, useState, type FormEvent } from 'react'
import { useHoldings, useSaveHoldings } from '../../lib/queries.ts'
import { ErrorBox, Spinner } from '../ui.tsx'

interface Row {
  ticker: string
  amount: string
  note: string
}

/** "2.500,75" → "2500.75"; "2500.75" fica; vírgula sem ponto vira ponto. */
function normalizeAmount(raw: string): string {
  const s = raw.trim().replace(/\s/g, '')
  if (s.includes(',')) return s.replace(/\./g, '').replace(',', '.')
  return s
}

/** Posições digitadas de uma conta manual. Salvar pede uma coleta. */
export function HoldingsEditor({ portfolioId, accountId, readOnly }: { portfolioId: string; accountId: string; readOnly: boolean }) {
  const holdings = useHoldings(accountId)
  const save = useSaveHoldings(portfolioId, accountId)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (holdings.data && rows === null) {
      setRows(holdings.data.map((h) => ({ ticker: h.ticker, amount: h.amount, note: h.note ?? '' })))
    }
  }, [holdings.data, rows])

  if (holdings.isPending || rows === null) return <Spinner />
  if (holdings.error) return <ErrorBox error={holdings.error} />

  const set = (i: number, patch: Partial<Row>) => {
    setSaved(false)
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const items = rows!
      .filter((r) => r.ticker.trim() || r.amount.trim())
      .map((r) => ({ ticker: r.ticker.trim().toUpperCase(), amount: normalizeAmount(r.amount), note: r.note.trim() || null }))
    await save.mutateAsync(items)
    setRows(items.map((i) => ({ ticker: i.ticker, amount: i.amount, note: i.note ?? '' })))
    setSaved(true)
  }

  if (readOnly) {
    return (
      <ul className="holdings-list">
        {rows.map((r) => (
          <li key={r.ticker}>
            <strong>{r.ticker}</strong> {r.amount} {r.note && <span className="muted">· {r.note}</span>}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <form className="holdings" onSubmit={(e) => void submit(e)}>
      {rows.length > 0 && (
        <div className="holdings-head" aria-hidden>
          <span>ativo</span>
          <span>quantidade</span>
          <span>nota</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="holdings-row">
          <input
            aria-label="ativo"
            value={r.ticker}
            onChange={(e) => set(i, { ticker: e.target.value.toUpperCase() })}
            placeholder="BTC"
            maxLength={20}
            pattern="[A-Za-z0-9]{1,20}"
            required
          />
          <input
            aria-label="quantidade"
            inputMode="decimal"
            value={r.amount}
            onChange={(e) => set(i, { amount: e.target.value })}
            placeholder="0,5"
            required
          />
          <input aria-label="nota" value={r.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="ledger" maxLength={200} />
          <button type="button" className="icon-btn" aria-label={`tirar ${r.ticker || 'linha'}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, { ticker: '', amount: '', note: '' }])}>
          + ativo
        </button>
        <button className="btn btn-primary btn-sm" disabled={save.isPending}>
          {save.isPending ? 'salvando…' : 'salvar posições'}
        </button>
        {saved && <span className="muted saved">salvo; o total atualiza em segundos</span>}
      </div>
      {save.error && <ErrorBox error={save.error} />}
    </form>
  )
}
