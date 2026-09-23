import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { HistoryPoint, Range } from '../../lib/api.ts'
import { brl, compact, dayLong, dayShort, usd } from '../../lib/format.ts'
import { useHistory } from '../../lib/queries.ts'
import { useCssVars } from '../../lib/useCssVars.ts'
import { ErrorBox, Spinner } from '../ui.tsx'

const RANGES: { value: Range; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '1y', label: '1a' },
  { value: 'all', label: 'tudo' },
]

const VARS = ['--series-1', '--grid', '--text-muted', '--surface'] as const

/** Evolução do total em R$, um ponto por dia. Uma série: sem legenda. */
export function History({ portfolioId }: { portfolioId: string }) {
  const [range, setRange] = useState<Range>('30d')
  const history = useHistory(portfolioId, range)
  const c = useCssVars(VARS)
  const points = (history.data ?? []).map((h) => ({ ...h, brl: Number(h.valueBrl) }))

  return (
    <div className="history">
      <div className="segmented" role="tablist" aria-label="período">
        {RANGES.map((r) => (
          <button key={r.value} role="tab" aria-selected={range === r.value} onClick={() => setRange(r.value)}>
            {r.label}
          </button>
        ))}
      </div>

      {history.isPending && <Spinner />}
      {history.error && <ErrorBox error={history.error} />}
      {history.data && points.length < 2 && (
        <p className="empty">O gráfico aparece a partir do segundo dia de coleta: o app guarda um retrato por dia.</p>
      )}
      {points.length >= 2 && (
        <div className="history-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c['--series-1']} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={c['--series-1']} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={c['--grid']} strokeWidth={1} />
              <XAxis
                dataKey="day"
                tickFormatter={dayShort}
                tick={{ fill: c['--text-muted'], fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                // Afasta o primeiro dia do rótulo de baixo do eixo Y.
                padding={{ left: 12 }}
              />
              {/* Só o número: o cartão já diz que é R$, e "R$" no eixo quebrava a linha. */}
              <YAxis
                width={52}
                tickFormatter={(v: number) => compact(v)}
                tick={{ fill: c['--text-muted'], fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip
                content={<DayTip />}
                cursor={{ stroke: c['--text-muted'], strokeWidth: 1 }}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="brl"
                stroke={c['--series-1']}
                strokeWidth={2}
                fill="url(#history-fill)"
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, fill: c['--series-1'], stroke: c['--surface'], strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function DayTip({ active, payload }: { active?: boolean; payload?: { payload: HistoryPoint }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="tip">
      <div className="tip-title">{dayLong(p.day)}</div>
      <div>{brl(p.valueBrl)}</div>
      <div className="tip-muted">{usd(p.valueUsd)}</div>
    </div>
  )
}
