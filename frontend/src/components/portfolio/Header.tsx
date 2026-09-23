import { useState, type FormEvent } from 'react'
import type { Summary } from '../../lib/api.ts'
import { brl, brlCompact, dateTime, monthYear, multiple, parseBrl, signedPct, trend, usd } from '../../lib/format.ts'
import { useOnline } from '../../lib/offline.ts'
import { useUpdatePortfolio } from '../../lib/queries.ts'
import { Delta, ErrorBox, Notice } from '../ui.tsx'

/** O número grande é o total em R$; logo abaixo, a distância do ATH. */
export function Header({ s }: { s: Summary }) {
  return (
    <section className="hero">
      <div className="hero-label">{s.name}</div>
      <div className="hero-value">{brl(s.valueBrl)}</div>
      <div className="hero-sub">
        {usd(s.valueUsd)}
        <span className="sep" aria-hidden>
          ·
        </span>
        24h <Delta value={s.chg24h} />
        <span className="sep" aria-hidden>
          ·
        </span>
        7d <Delta value={s.chg7d} />
      </div>

      <div className="hero-ath">
        <span className="hero-ath-label">Se tudo voltar ao ATH</span>
        <span className="hero-ath-value">
          {brlCompact(s.valueAtAthBrl)} <span className="hero-ath-multiple">{multiple(s.athMultiple)}</span>
        </span>
      </div>

      <Invested s={s} />

      {s.stale && (
        <Notice tone="warn" icon="!">
          Alguma conta falhou na última coleta. O total usa o último saldo bom dela.
        </Notice>
      )}
      {s.unpriced > 0 && (
        <Notice icon="?">
          {s.unpriced === 1 ? 'Um ativo está' : `${s.unpriced} ativos estão`} sem cotação na Binance e na OKX e não entram no total.
        </Notice>
      )}
      <div className="hero-foot">
        coleta de {dateTime(s.asOf)} · US$ 1 = {brl(s.usdBrl)}
      </div>
    </section>
  )
}

/** "Investido R$ 12.000 · +44,05%": digitado, como a J17 da planilha. */
function Invested({ s }: { s: Summary }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const update = useUpdatePortfolio(s.id)
  const online = useOnline()
  const owner = s.role === 'owner' && online

  function start() {
    setValue(s.investedBrl ? brl(s.investedBrl).replace('R$ ', '') : '')
    setInvalid(false)
    update.reset()
    setEditing(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    // "12.345", "12.345,00", "R$ 12.345,00"…; vazio apaga.
    const parsed = parseBrl(value)
    if (parsed === null) {
      setInvalid(true)
      return
    }
    await update.mutateAsync({ investedBrl: parsed === '' ? null : parsed })
    setEditing(false)
  }

  if (editing) {
    return (
      <form className="invested-form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>Quanto você investiu (R$)</span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setInvalid(false)
            }}
            placeholder="12.345,00"
            aria-invalid={invalid}
            autoFocus
          />
        </label>
        {invalid && <p className="field-error">Não entendi esse valor. Escreva só o número, como 12.345,00 ou 12345.</p>}
        <div className="row">
          <button className="btn btn-primary btn-sm" disabled={update.isPending}>
            salvar
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
            cancelar
          </button>
        </div>
        {update.error && <ErrorBox error={update.error} />}
      </form>
    )
  }

  const calc = s.investedCalcBrl ?? null
  const differs = calc !== null && (!s.investedBrl || Number(calc).toFixed(2) !== Number(s.investedBrl).toFixed(2))

  // Sem informado: o calculado ocupa o lugar, identificado como calculado.
  if (!s.investedBrl) {
    if (calc === null) {
      return owner ? (
        <button className="link-btn" onClick={start}>
          + quanto você investiu? (para ver o resultado)
        </button>
      ) : null
    }
    return (
      <div className="invested">
        <div className="hero-invested">
          Investido {brl(calc)} <span className="muted">(pelos depósitos)</span>
          <span className="sep" aria-hidden>
            ·
          </span>
          <span className={`delta ${trend(s.resultCalcPct)}`}>{signedPct(s.resultCalcPct)}</span>
        </div>
        <CalcDetail s={s} />
        {owner && (
          <div className="row">
            <button className="link-btn" onClick={() => void update.mutateAsync({ investedBrl: Number(calc).toFixed(2) })}>
              usar este valor
            </button>
            <button className="link-btn" onClick={start}>
              informar outro
            </button>
          </div>
        )}
        {update.error && <ErrorBox error={update.error} />}
      </div>
    )
  }

  return (
    <div className="invested">
      <div className="hero-invested">
        Investido {brl(s.investedBrl)}
        <span className="sep" aria-hidden>
          ·
        </span>
        <span className={`delta ${trend(s.resultPct)}`}>{signedPct(s.resultPct)}</span>
        {owner && (
          <button className="link-btn" onClick={start} aria-label="editar valor investido">
            editar
          </button>
        )}
      </div>
      {calc !== null && (
        <div className="invested-calc">
          Pelos depósitos: {brl(calc)}
          {differs && (
            <span className="muted">
              {' '}
              ({Number(calc) > Number(s.investedBrl) ? '+' : '−'}
              {brl(Math.abs(Number(calc) - Number(s.investedBrl)))})
            </span>
          )}
          {owner && differs && (
            <button className="link-btn" onClick={() => void update.mutateAsync({ investedBrl: Number(calc).toFixed(2) })}>
              usar este valor
            </button>
          )}
        </div>
      )}
      {calc !== null && <CalcDetail s={s} />}
      {update.error && <ErrorBox error={update.error} />}
    </div>
  )
}

/** De onde sai o calculado, e o que ainda não entra nele. */
function CalcDetail({ s }: { s: Summary }) {
  const deposits = s.investedCalcDeposits ?? 0
  const withdrawals = s.investedCalcWithdrawals ?? 0
  const missing = s.investedCalcMissing ?? 0
  return (
    <div className="invested-detail">
      {deposits} {deposits === 1 ? 'depósito' : 'depósitos'} em reais desde {monthYear(s.investedCalcSince)}
      {withdrawals > 0 && `, menos ${withdrawals} ${withdrawals === 1 ? 'saque' : 'saques'}`}. Transferência de cripto entre corretoras não conta.
      {missing > 0 && ` ${missing === 1 ? 'Uma conta ainda não entra' : `${missing} contas ainda não entram`} nessa soma (a OKX, por enquanto).`}
    </div>
  )
}
