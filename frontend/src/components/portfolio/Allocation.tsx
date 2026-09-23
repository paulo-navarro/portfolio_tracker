import { useState } from 'react'
import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import type { Position } from '../../lib/api.ts'
import { brl, pct } from '../../lib/format.ts'
import { useCssVars } from '../../lib/useCssVars.ts'

// Rosca com no máximo 6 fatias: as 5 maiores e "outros". Mais que isso não se
// compara de olho; o número de cada um está na lista de posições.
const TOP = 5
// Tamanho fixo: a rosca não precisa medir o contêiner (e medir dentro de um
// grid realimenta a largura da coluna, em laço).
const SIZE = 168
const SLOTS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-other', '--surface'] as const

interface Slice {
  name: string
  value: number
  brl: number
  pct: number
  color: string
}

export function Allocation({ positions }: { positions: Position[] }) {
  const colors = useCssVars(SLOTS)
  const [active, setActive] = useState<string | null>(null)
  const priced = positions.filter((p) => p.valueUsd !== null && Number(p.valueUsd) > 0)
  if (priced.length === 0) return null

  const sorted = [...priced].sort((a, b) => Number(b.valueUsd) - Number(a.valueUsd))
  const head = sorted.length <= TOP + 1 ? sorted : sorted.slice(0, TOP)
  const tail = sorted.length <= TOP + 1 ? [] : sorted.slice(TOP)
  const slices: Slice[] = head.map((p, i) => ({
    name: p.ticker,
    value: Number(p.valueUsd),
    brl: Number(p.valueBrl),
    pct: Number(p.allocationPct),
    color: colors[SLOTS[i]],
  }))
  if (tail.length > 0) {
    slices.push({
      name: `outros (${tail.length})`,
      value: tail.reduce((s, p) => s + Number(p.valueUsd), 0),
      brl: tail.reduce((s, p) => s + Number(p.valueBrl), 0),
      pct: tail.reduce((s, p) => s + Number(p.allocationPct), 0),
      color: colors['--series-other'],
    })
  }

  return (
    <div className="allocation">
      <div className="donut" role="img" aria-label={`alocação: ${slices.map((s) => `${s.name} ${pct(s.pct, 1)}`).join(', ')}`}>
        <PieChart width={SIZE} height={SIZE}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="64%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              // 2px de fundo entre as fatias, em vez de borda.
              stroke={colors['--surface']}
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setActive(slices[i].name)}
              onMouseLeave={() => setActive(null)}
            >
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} opacity={active && active !== s.name ? 0.35 : 1} />
              ))}
            </Pie>
            <Tooltip content={<SliceTip />} isAnimationActive={false} />
        </PieChart>
        <div className="donut-center" aria-hidden>
          <span className="donut-center-value">{positions.length}</span>
          <span className="donut-center-label">{positions.length === 1 ? 'ativo' : 'ativos'}</span>
        </div>
      </div>

      <ul className="legend">
        {slices.map((s) => (
          <li key={s.name} onMouseEnter={() => setActive(s.name)} onMouseLeave={() => setActive(null)} className={active === s.name ? 'is-active' : ''}>
            <span className="swatch" style={{ background: s.color }} aria-hidden />
            <span className="legend-name">{s.name}</span>
            <span className="legend-value">{pct(s.pct, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SliceTip({ active, payload }: { active?: boolean; payload?: { payload: Slice }[] }) {
  if (!active || !payload?.length) return null
  const s = payload[0].payload
  return (
    <div className="tip">
      <div className="tip-title">
        <span className="swatch" style={{ background: s.color }} aria-hidden /> {s.name}
      </div>
      <div>{brl(s.brl)}</div>
      <div className="tip-muted">{pct(s.pct, 2)} da carteira</div>
    </div>
  )
}
