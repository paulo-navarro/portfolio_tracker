import { useSyncExternalStore } from 'react'

/**
 * Online segundo o navegador. `navigator.onLine` mente para mais (wi-fi sem
 * internet aparece como online), nunca para menos: quando ele diz offline, é
 * offline mesmo. Serve para desabilitar o que escreve.
 */
function subscribe(fn: () => void) {
  window.addEventListener('online', fn)
  window.addEventListener('offline', fn)
  return () => {
    window.removeEventListener('online', fn)
    window.removeEventListener('offline', fn)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}
