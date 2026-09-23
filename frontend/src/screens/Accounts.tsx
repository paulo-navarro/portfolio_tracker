import { useState, type FormEvent, type ReactNode } from 'react'
import { Guide } from '../components/accounts/Guide.tsx'
import { HoldingsEditor } from '../components/accounts/HoldingsEditor.tsx'
import { KeyForm } from '../components/accounts/KeyForm.tsx'
import { Shell } from '../components/Shell.tsx'
import { ErrorBox, Notice, Section, Spinner, StatusChip } from '../components/ui.tsx'
import { ApiError, type Account, type Summary } from '../lib/api.ts'
import { ago } from '../lib/format.ts'
import {
  useAccounts,
  useArchivePortfolio,
  useCreateAccount,
  useMeta,
  useRemoveAccount,
  useReplaceKey,
  useSummary,
  useUpdatePortfolio,
} from '../lib/queries.ts'
import { navigate } from '../lib/router.tsx'
import { NotFoundPortfolio } from './Portfolio.tsx'

const KIND: Record<Account['kind'], string> = { binance: 'Binance', okx: 'OKX', manual: 'Manual' }

export function Accounts({ id }: { id: string }) {
  const summary = useSummary(id)
  const accounts = useAccounts(id)
  const owner = summary.data?.role === 'owner'

  if (accounts.error instanceof ApiError && accounts.error.status === 404) return <NotFoundPortfolio />

  return (
    <Shell back={{ to: `/p/${id}`, label: summary.data?.name ?? 'Portfólio' }} title="Contas">
      <Section title="Contas">
        {accounts.isPending && <Spinner />}
        {accounts.error && <ErrorBox error={accounts.error} />}
        {accounts.data?.length === 0 && <p className="empty">Nenhuma conta ainda.</p>}
        <ul className="accounts">
          {accounts.data?.map((a) => (
            <AccountRow key={a.id} a={a} actions={<AccountActions portfolioId={id} a={a} owner={owner} />} />
          ))}
        </ul>
      </Section>

      {owner && <AddAccount portfolioId={id} />}
      {owner && summary.data && <PortfolioSettings s={summary.data} />}
    </Shell>
  )
}

export function AccountRow({ a, actions }: { a: Account; actions?: ReactNode }) {
  return (
    <li className="account">
      <div className="account-head">
        <span className="account-name">{a.label}</span>
        <span className="account-kind">{KIND[a.kind]}</span>
        <StatusChip status={a.status} />
      </div>
      {a.statusReason && a.status !== 'active' && (
        <Notice tone={a.status === 'pending' ? 'info' : 'error'}>{a.statusReason}</Notice>
      )}
      {a.status === 'pending' && !a.statusReason && <Notice icon="◌">Conferindo a chave com a corretora…</Notice>}
      <div className="account-meta">
        {a.keyHint && <span>chave …{a.keyHint}</span>}
        {a.kind !== 'manual' && a.ipRestricted !== null && <span>{a.ipRestricted ? 'IP vinculado' : 'sem IP vinculado'}</span>}
        <span>última coleta {ago(a.lastSyncAt)}</span>
      </div>
      {actions}
    </li>
  )
}

type Panel = null | 'key' | 'holdings' | 'remove'

function AccountActions({ portfolioId, a, owner }: { portfolioId: string; a: Account; owner: boolean }) {
  const [panel, setPanel] = useState<Panel>(null)
  const replace = useReplaceKey(portfolioId, a.id)
  const remove = useRemoveAccount(portfolioId, a.id)
  const meta = useMeta()
  const toggle = (p: Panel) => setPanel(panel === p ? null : p)
  // Chave recusada ou bloqueada: trocar é o caminho, então o painel já abre.
  const needsKey = a.kind !== 'manual' && ['rejected', 'blocked', 'error'].includes(a.status)

  return (
    <>
      <div className="row account-actions">
        {a.kind === 'manual' ? (
          <button className="btn btn-ghost btn-sm" onClick={() => toggle('holdings')} aria-expanded={panel === 'holdings'}>
            {owner ? 'editar posições' : 'ver posições'}
          </button>
        ) : (
          owner && (
            <button className={`btn btn-sm ${needsKey ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggle('key')} aria-expanded={panel === 'key'}>
              trocar chave
            </button>
          )
        )}
        {owner && (
          <button className="btn btn-ghost btn-sm" onClick={() => toggle('remove')} aria-expanded={panel === 'remove'}>
            remover
          </button>
        )}
      </div>

      {panel === 'holdings' && <HoldingsEditor portfolioId={portfolioId} accountId={a.id} readOnly={!owner} />}

      {panel === 'key' && a.kind !== 'manual' && (
        <div className="panel">
          <p className="fine">
            A chave nova tem que ser da <strong>mesma conta</strong> da corretora: chave de outra conta é recusada, para não misturar históricos.
          </p>
          <Guide kind={a.kind} egressIp={meta.data?.egressIp ?? null} />
          <KeyForm
            kind={a.kind}
            submitLabel="selar e trocar"
            onSealed={async (sealed) => {
              await replace.mutateAsync(sealed)
              setPanel(null)
            }}
            onCancel={() => setPanel(null)}
          />
        </div>
      )}

      {panel === 'remove' && (
        <div className="panel panel-danger">
          <p>
            Remover <strong>{a.label}</strong>? Ela sai do total a partir da próxima coleta; o histórico fica.
          </p>
          {a.kind !== 'manual' && (
            <p className="fine">
              A chave é apagada daqui, mas continua existindo na {KIND[a.kind]}. <strong>Revogue a chave lá também.</strong>
            </p>
          )}
          <div className="row">
            <button className="btn btn-danger btn-sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? 'removendo…' : 'remover'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPanel(null)}>
              cancelar
            </button>
          </div>
          {remove.error && <ErrorBox error={remove.error} />}
        </div>
      )}
    </>
  )
}

type Kind = 'binance' | 'okx' | 'manual'

function AddAccount({ portfolioId }: { portfolioId: string }) {
  const [kind, setKind] = useState<Kind | null>(null)
  const create = useCreateAccount(portfolioId)
  const meta = useMeta()
  const [manualLabel, setManualLabel] = useState('Fora de corretora')
  const [created, setCreated] = useState<string | null>(null)

  async function createManual(e: FormEvent) {
    e.preventDefault()
    const { id } = await create.mutateAsync({ kind: 'manual', label: manualLabel.trim() })
    setCreated(id)
  }

  return (
    <Section title="Adicionar conta">
      <div className="segmented kind-picker" role="tablist" aria-label="tipo de conta">
        {(['binance', 'okx', 'manual'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => {
              setKind(k)
              setCreated(null)
              create.reset()
            }}
          >
            {KIND[k]}
          </button>
        ))}
      </div>

      {kind === null && <p className="empty">Escolha de onde vem o saldo. Corretora: chave só de leitura. Manual: você digita as quantidades.</p>}

      {(kind === 'binance' || kind === 'okx') && (
        <div className="panel">
          <Guide kind={kind} egressIp={meta.data?.egressIp ?? null} />
          <KeyForm
            key={kind}
            kind={kind}
            withLabel
            submitLabel="selar e cadastrar"
            onSealed={async (sealed, label) => {
              await create.mutateAsync({ kind, label, ...sealed })
              setKind(null)
            }}
          />
        </div>
      )}

      {kind === 'manual' && !created && (
        <form className="inline-form panel" onSubmit={(e) => void createManual(e)}>
          <p className="fine">Para o que está fora da Binance e da OKX: carteira, outra corretora. O preço vem da coleta; a quantidade é você quem digita.</p>
          <label className="field">
            <span>Nome da conta</span>
            <input value={manualLabel} onChange={(e) => setManualLabel(e.target.value)} maxLength={40} required />
          </label>
          <div className="row">
            <button className="btn btn-primary" disabled={create.isPending}>
              criar
            </button>
          </div>
          {create.error && <ErrorBox error={create.error} />}
        </form>
      )}

      {kind === 'manual' && created && (
        <div className="panel">
          <p className="fine">Agora as posições de {manualLabel}:</p>
          <HoldingsEditor portfolioId={portfolioId} accountId={created} readOnly={false} />
        </div>
      )}

      {create.error && kind !== 'manual' && <ErrorBox error={create.error} />}
    </Section>
  )
}

/** Renomear e arquivar. O investido fica no cabeçalho do portfólio. */
function PortfolioSettings({ s }: { s: Summary }) {
  const [name, setName] = useState(s.name)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const update = useUpdatePortfolio(s.id)
  const archive = useArchivePortfolio(s.id)

  async function rename(e: FormEvent) {
    e.preventDefault()
    await update.mutateAsync({ name: name.trim() })
  }

  return (
    <Section title="Portfólio">
      <form className="inline-form" onSubmit={(e) => void rename(e)}>
        <label className="field">
          <span>Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </label>
        <div className="row">
          <button className="btn btn-ghost btn-sm" disabled={update.isPending || name.trim() === s.name || !name.trim()}>
            renomear
          </button>
        </div>
        {update.error && <ErrorBox error={update.error} />}
      </form>

      <div className="archive">
        {!confirmArchive ? (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmArchive(true)}>
            arquivar portfólio
          </button>
        ) : (
          <div className="panel panel-danger">
            <p>
              Arquivar <strong>{s.name}</strong>? Ele some das listas. O histórico fica guardado.
            </p>
            <div className="row">
              <button
                className="btn btn-danger btn-sm"
                disabled={archive.isPending}
                onClick={() => archive.mutate(undefined, { onSuccess: () => navigate('/') })}
              >
                arquivar
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmArchive(false)}>
                cancelar
              </button>
            </div>
            {archive.error && <ErrorBox error={archive.error} />}
          </div>
        )}
      </div>
    </Section>
  )
}
