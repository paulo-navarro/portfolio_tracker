/// <reference lib="webworker" />
/**
 * Service worker. Guarda **só o app** (o que o Vite gerou): HTML, JS, CSS e
 * ícones. `/api` nunca é cacheado — saldo velho servido como novo seria pior
 * que não abrir. Quem guarda o último dado é o IndexedDB, com a hora junto.
 *
 * injectManifest (e não generateSW) porque o push da fase 7 mora aqui.
 */
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Qualquer rota do app abre o index (é uma SPA). `/api` fica de fora: offline,
// a requisição falha e a tela mostra o último dado guardado.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
)

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') void self.skipWaiting()
})
