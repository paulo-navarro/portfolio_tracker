/**
 * O último dado de cada tela, guardado no IndexedDB, para abrir offline
 * mostrando o que já se sabia (com a hora junto, no topo).
 *
 * Só respostas de leitura entram. Nada de credencial: a chave da corretora
 * nunca passa por aqui, e as respostas da api não trazem nenhuma.
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { QueryClient } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { clear, del, get, set } from 'idb-keyval'

const KEY = 'cripto-cache'
// Dado mais velho que isto não volta: melhor tela vazia que número de semana passada.
const MAX_AGE = 7 * 24 * 60 * 60 * 1000

export function setupPersistence(queryClient: QueryClient) {
  const persister = createAsyncStoragePersister({
    storage: {
      getItem: async (k) => (await get<string>(k)) ?? null,
      setItem: (k, v) => set(k, v),
      removeItem: (k) => del(k),
    },
    key: KEY,
    throttleTime: 2_000,
  })

  persistQueryClient({
    queryClient,
    persister,
    maxAge: MAX_AGE,
    // Troca de versão do app invalida o que estava guardado.
    buster: __BUILD_ID__,
    dehydrateOptions: {
      // `me` entra: offline é ele que diz que já havia alguém logado, senão a
      // tela não sai de "carregando". Quem tem a palavra final é o servidor: um
      // 401 em qualquer requisição derruba a sessão na hora.
      // Sessões e opções de login ficam de fora: são estado do servidor.
      shouldDehydrateQuery: (q) => q.state.status === 'success' && !['sessions', 'authOptions'].includes(String(q.queryKey[0])),
    },
  })
}

/** Sair apaga tudo que ficou no aparelho. */
export async function clearPersistedCache() {
  try {
    await clear()
  } catch {
    // Sem IndexedDB (navegação privada): não havia o que apagar.
  }
}
