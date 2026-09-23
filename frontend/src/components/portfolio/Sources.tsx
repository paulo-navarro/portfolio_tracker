import type { Source } from '../../lib/api.ts'
import { brl, qty } from '../../lib/format.ts'

const WALLET: Record<string, string> = {
  spot: 'spot',
  funding: 'funding',
  earn_flexible: 'earn flexível',
  earn_locked: 'earn travado',
  trading: 'trading',
  savings: 'earn',
  staking: 'staking',
  manual: 'manual',
}

/** Onde está: o que antes eram as linhas 22 a 30 da planilha, preenchido pela coleta. */
export function Sources({ sources }: { sources: Source[] }) {
  const byAccount = new Map<string, Source[]>()
  for (const s of sources) byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s])

  if (sources.length === 0) return <p className="empty">Nada coletado ainda.</p>

  return (
    <div className="sources">
      {[...byAccount.values()].map((rows) => {
        const total = rows.reduce((s, r) => s + (r.valueBrl === null ? 0 : Number(r.valueBrl)), 0)
        return (
          <div key={rows[0].accountId} className="source">
            <div className="source-head">
              <span className="source-name">
                {rows[0].label}
                {rows[0].stale && <span className="chip chip-warn">desatualizada</span>}
              </span>
              <span className="source-total">{brl(total)}</span>
            </div>
            <ul>
              {rows.map((r) => (
                <li key={`${r.wallet}-${r.ticker}`}>
                  <span className="source-ticker">{r.ticker}</span>
                  <span className="source-wallet">{WALLET[r.wallet] ?? r.wallet}</span>
                  <span className="source-qty">{qty(r.amount)}</span>
                  <span className="source-value">{brl(r.valueBrl)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
