/**
 * Roteamento sem lib, como no shouldWe: quatro telas cabem num switch.
 *   /                 Início
 *   /p/:id            Portfólio
 *   /p/:id/contas     Contas
 *   /ajustes          Ajustes
 */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  window.addEventListener('popstate', fn)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('popstate', fn)
  }
}

export function navigate(to: string, replace = false) {
  if (to === window.location.pathname + window.location.search) return
  if (replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.scrollTo(0, 0)
  for (const fn of listeners) fn()
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

export type Route =
  | { name: 'home' }
  | { name: 'portfolio'; id: string }
  | { name: 'accounts'; id: string }
  | { name: 'settings' }
  | { name: 'notFound' }

export function match(path: string): Route {
  if (path === '/') return { name: 'home' }
  if (path === '/ajustes') return { name: 'settings' }
  let m = path.match(/^\/p\/([0-9a-f-]{36})\/?$/i)
  if (m) return { name: 'portfolio', id: m[1] }
  m = path.match(/^\/p\/([0-9a-f-]{36})\/contas\/?$/i)
  if (m) return { name: 'accounts', id: m[1] }
  return { name: 'notFound' }
}

/** <a> que navega sem recarregar (e continua abrindo em aba nova com Ctrl/⌘). */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handle} {...rest} />
}
