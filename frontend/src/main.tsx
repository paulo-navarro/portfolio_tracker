import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App.tsx'
import { ApiError } from './lib/api.ts'
import { setupPersistence } from './lib/persist.ts'
import { keys } from './lib/queries.ts'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Guardado no IndexedDB por até 7 dias: é o que a tela mostra offline.
      gcTime: 7 * 24 * 60 * 60 * 1000,
      // 4xx não melhora tentando de novo.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

// Sessão que morreu no meio do uso (expirou, saiu de todos em outro aparelho):
// qualquer 401 manda de volta para a tela de entrar.
queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error
  if (err instanceof ApiError && err.status === 401 && event.query.queryKey[0] !== 'me') {
    queryClient.setQueryData(keys.me, null)
  }
})

// Guarda o último dado de cada tela para abrir offline.
setupPersistence(queryClient)

// Versão nova assume sozinha na próxima abertura.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
