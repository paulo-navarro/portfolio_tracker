/**
 * Tudo que a tela lê e escreve, em TanStack Query. A coleta roda a cada 15
 * minutos: reler a cada 5 é o bastante para o "há N min" nunca mentir muito.
 */
import { navigate } from './router.tsx'
import type { Sealed } from './seal.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  ApiError,
  type Account,
  type HistoryPoint,
  type Holding,
  type Me,
  type Meta,
  type Position,
  type Range,
  type SessionInfo,
  type Source,
  type Summary,
} from './api.ts'

const LIVE = { refetchInterval: 5 * 60_000 }

export const keys = {
  me: ['me'] as const,
  portfolios: ['portfolios'] as const,
  summary: (id: string) => ['portfolio', id, 'summary'] as const,
  positions: (id: string) => ['portfolio', id, 'positions'] as const,
  sources: (id: string) => ['portfolio', id, 'sources'] as const,
  history: (id: string, range: Range) => ['portfolio', id, 'history', range] as const,
  accounts: (id: string) => ['portfolio', id, 'accounts'] as const,
  holdings: (accountId: string) => ['account', accountId, 'holdings'] as const,
  sessions: ['sessions'] as const,
  meta: ['meta'] as const,
  authOptions: ['authOptions'] as const,
}

/** null = não entrou (401). Qualquer outro erro sobe. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/me')
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
  })
}

export const useAuthOptions = () =>
  useQuery({ queryKey: keys.authOptions, queryFn: () => api.get<{ google: boolean; dev: boolean }>('/api/auth/options') })

export const usePortfolios = () => useQuery({ queryKey: keys.portfolios, queryFn: () => api.get<Summary[]>('/api/portfolios'), ...LIVE })

export const useSummary = (id: string) =>
  useQuery({ queryKey: keys.summary(id), queryFn: () => api.get<Summary>(`/api/portfolios/${id}/summary`), ...LIVE })

export const usePositions = (id: string) =>
  useQuery({ queryKey: keys.positions(id), queryFn: () => api.get<Position[]>(`/api/portfolios/${id}/positions`), ...LIVE })

export const useSources = (id: string) =>
  useQuery({ queryKey: keys.sources(id), queryFn: () => api.get<Source[]>(`/api/portfolios/${id}/sources`), ...LIVE })

export const useHistory = (id: string, range: Range) =>
  useQuery({
    queryKey: keys.history(id, range),
    queryFn: () => api.get<HistoryPoint[]>(`/api/portfolios/${id}/history?range=${range}`),
    ...LIVE,
  })

export const useAccounts = (id: string, poll = false) =>
  useQuery({
    queryKey: keys.accounts(id),
    queryFn: () => api.get<Account[]>(`/api/portfolios/${id}/accounts`),
    // Conta pendente: o worker decide em segundos. Relê rápido até decidir.
    refetchInterval: (q) => (poll || q.state.data?.some((a) => a.status === 'pending') ? 3_000 : 5 * 60_000),
  })

export const useHoldings = (accountId: string) =>
  useQuery({ queryKey: keys.holdings(accountId), queryFn: () => api.get<Holding[]>(`/api/accounts/${accountId}/holdings`) })

export const useSessions = () => useQuery({ queryKey: keys.sessions, queryFn: () => api.get<SessionInfo[]>('/api/sessions') })

export const useMeta = () => useQuery({ queryKey: keys.meta, queryFn: () => api.get<Meta>('/api/meta'), ...LIVE })

// ── Escritas ────────────────────────────────────────

export function useCreatePortfolio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; investedBrl?: string | null }) => api.post<{ id: string }>('/api/portfolios', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.portfolios })
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

export function useUpdatePortfolio(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name?: string; investedBrl?: string | null }) => api.patch(`/api/portfolios/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolio', id] })
      void qc.invalidateQueries({ queryKey: keys.portfolios })
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

export function useArchivePortfolio(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/api/portfolios/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.portfolios })
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

/** Sair limpa todo o cache e volta para a tela de entrar. */
function signedOut(qc: ReturnType<typeof useQueryClient>) {
  qc.clear()
  qc.setQueryData(keys.me, null)
  navigate('/', true)
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => api.post('/api/auth/logout'), onSettled: () => signedOut(qc) })
}

export function useLogoutEverywhere() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => api.delete('/api/sessions'), onSettled: () => signedOut(qc) })
}

// ── Contas ──────────────────────────────────────────

function invalidatePortfolio(qc: ReturnType<typeof useQueryClient>, portfolioId: string) {
  void qc.invalidateQueries({ queryKey: ['portfolio', portfolioId] })
  void qc.invalidateQueries({ queryKey: keys.portfolios })
}

type NewAccount = { kind: 'manual'; label: string } | ({ kind: 'binance' | 'okx'; label: string } & Sealed)

export function useCreateAccount(portfolioId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NewAccount) => api.post<{ id: string }>(`/api/portfolios/${portfolioId}/accounts`, body),
    onSuccess: () => invalidatePortfolio(qc, portfolioId),
  })
}

export function useReplaceKey(portfolioId: string, accountId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Sealed) => api.put(`/api/accounts/${accountId}/credentials`, body),
    onSuccess: () => invalidatePortfolio(qc, portfolioId),
  })
}

export function useRemoveAccount(portfolioId: string, accountId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/api/accounts/${accountId}`),
    onSuccess: () => invalidatePortfolio(qc, portfolioId),
  })
}

export function useSaveHoldings(portfolioId: string, accountId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { ticker: string; amount: string; note?: string | null }[]) => api.put(`/api/accounts/${accountId}/holdings`, items),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.holdings(accountId) })
      // A coleta que a api pediu leva alguns segundos: relê o portfólio depois.
      setTimeout(() => invalidatePortfolio(qc, portfolioId), 4_000)
    },
  })
}
