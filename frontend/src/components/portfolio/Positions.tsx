import { useState } from 'react'
import type { Position } from '../../lib/api.ts'
import { brl, pct, priceBrl, priceUsd, qty, usd } from '../../lib/format.ts'
import { AthBar, Delta } from '../ui.tsx'

/**
 * No celular, uma linha compacta por ativo (ticker, R$, 24h e a barra do
 * ATH) que abre para o resto. No computador, a tabela da planilha: as mesmas
 * 13 colunas, na mesma ordem, ordenável.
 */
export function Positions({ positions }: { positions: Position[] }) {
  return (
    <>
      <PositionList positions={positions} />
      <PositionTable positions={positions} />
    </>
  )
}

/** No ATH quando o preço alcançou (ou passou) o topo que conhecemos. */
function atAth(p: Position) {
  return p.pctBelowAth !== null && Number(p.pctBelowAth) < 0.05
}

function athLabel(p: Position) {
  if (p.pctBelowAth === null) return 'sem ATH'
  if (!atAth(p)) return `−${pct(Number(p.pctBelowAth), 1)} do ATH`
  // Passou do topo anterior: diz quanto. Menos de 0,05% é "no ATH" e pronto.
  const above = p.pctAboveAth === null ? 0 : Number(p.pctAboveAth)
  return above >= 0.05 ? `novo ATH +${pct(above, 1)}` : 'no ATH'
}

function PositionList({ positions }: { positions: Position[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <ul className="positions only-mobile">
      {positions.map((p) => {
        const expanded = open === p.ticker
        return (
          <li key={p.ticker} className={`position ${expanded ? 'is-open' : ''}`}>
            <button className="position-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.ticker)}>
              <span className="position-ticker">
                {p.ticker}
                {p.stale && (
                  <span className="stale-dot" title="desatualizado">
                    !
                  </span>
                )}
              </span>
              <span className="position-value">{brl(p.valueBrl)}</span>
              <Delta value={p.chg24h} className="position-delta" />
              <span className="position-ath">
                <AthBar pctBelowAth={p.pctBelowAth} atAth={atAth(p)} />
                <span className={`position-ath-label ${atAth(p) ? 'is-ath' : ''}`}>{athLabel(p)}</span>
              </span>
            </button>
            {expanded && (
              <dl className="position-details">
                <div>
                  <dt>quantidade</dt>
                  <dd>{qty(p.qty)}</dd>
                </div>
                <div>
                  <dt>preço</dt>
                  <dd>{priceUsd(p.priceUsd)}</dd>
                </div>
                <div>
                  <dt>ATH</dt>
                  <dd>{priceUsd(p.athUsd)}</dd>
                </div>
                <div>
                  <dt>da carteira</dt>
                  <dd>{pct(p.allocationPct)}</dd>
                </div>
                <div>
                  <dt>7 dias</dt>
                  <dd>
                    <Delta value={p.chg7d} />
                  </dd>
                </div>
                <div>
                  <dt>no ATH</dt>
                  <dd>{brl(p.valueAtAthBrl)}</dd>
                </div>
              </dl>
            )}
          </li>
        )
      })}
    </ul>
  )
}

type Key = keyof Position
interface Col {
  key: Key
  label: string
  title: string
  render: (p: Position) => React.ReactNode
}

// A ordem e os nomes da planilha (colunas A a M).
const COLS: Col[] = [
  { key: 'ticker', label: 'Ativo', title: 'TICKER', render: (p) => <strong>{p.ticker}</strong> },
  { key: 'qty', label: 'Quantidade', title: 'AMOUNT', render: (p) => qty(p.qty) },
  { key: 'priceUsd', label: 'Preço', title: 'DOLAR PRICE', render: (p) => priceUsd(p.priceUsd) },
  { key: 'athUsd', label: 'ATH', title: 'ATH', render: (p) => priceUsd(p.athUsd) },
  {
    key: 'pctBelowAth',
    label: 'Até o ATH',
    title: '% to ATH',
    render: (p) => (p.pctBelowAth === null ? '—' : atAth(p) ? <span className="is-ath">{athLabel(p)}</span> : pct(p.pctBelowAth)),
  },
  { key: 'valueUsd', label: 'Valor US$', title: 'DOLAR AMOUNT', render: (p) => usd(p.valueUsd) },
  { key: 'valueAtAthUsd', label: 'US$ no ATH', title: 'D ON ATH', render: (p) => usd(p.valueAtAthUsd) },
  { key: 'valueAtAthBrl', label: 'R$ no ATH', title: 'R ON ATH', render: (p) => brl(p.valueAtAthBrl) },
  { key: 'allocationPct', label: '%', title: 'PERCENT', render: (p) => pct(p.allocationPct) },
  { key: 'priceBrl', label: 'Preço R$', title: 'REAL PRICE', render: (p) => priceBrl(p.priceBrl) },
  { key: 'valueBrl', label: 'Valor R$', title: 'REAL AMOUNT', render: (p) => brl(p.valueBrl) },
  { key: 'chg24h', label: '24h', title: 'DAY', render: (p) => <Delta value={p.chg24h} /> },
  { key: 'chg7d', label: '7d', title: '7', render: (p) => <Delta value={p.chg7d} /> },
]

function PositionTable({ positions }: { positions: Position[] }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'valueUsd', dir: -1 })

  const sorted = [...positions].sort((a, b) => {
    const va = a[sort.key]
    const vb = b[sort.key]
    if (sort.key === 'ticker') return String(va).localeCompare(String(vb)) * sort.dir
    // Vazio sempre por último, qualquer que seja a direção.
    if (va === null) return 1
    if (vb === null) return -1
    return (Number(va) - Number(vb)) * sort.dir
  })

  function toggle(key: Key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'ticker' ? 1 : -1 }))
  }

  return (
    <div className="table-wrap only-desktop">
      <table className="sheet">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                title={`planilha: ${c.title}`}
                aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
              >
                <button onClick={() => toggle(c.key)}>
                  {c.label}
                  <span className="sort" aria-hidden>
                    {sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.ticker} className={p.stale ? 'is-stale' : ''}>
              {COLS.map((c) => (
                <td key={c.key}>{c.render(p)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
