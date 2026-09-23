import { useEffect, useState } from 'react'

/**
 * Lê tokens de cor do CSS para o Recharts, que escreve cor em atributo SVG
 * (onde `var(--x)` não resolve em todo navegador). Relê quando o sistema troca
 * entre claro e escuro.
 */
export function useCssVars<const T extends readonly string[]>(names: T): Record<T[number], string> {
  const read = () => {
    const style = getComputedStyle(document.documentElement)
    return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(n).trim()])) as Record<T[number], string>
  }
  const [vars, setVars] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setVars(read())
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return vars
}
