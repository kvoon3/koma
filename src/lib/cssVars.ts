import type { CSSProperties } from 'react'

type CSSVariable = `--${string}`

/** Merge CSS custom properties into a style object, which React's type omits. */
export function cssVars(vars: Record<CSSVariable, string | number>, style: CSSProperties = {}): CSSProperties {
  return Object.assign({}, style, vars)
}
