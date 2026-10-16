import type { CSSProperties } from 'react'
import type { DockBg, ToolsDockMode } from '../store'

/**
 * Can `backdrop-filter: url(#svg)` actually refract? Only Chromium renders
 * SVG filters in backdrop-filter; Safari/WebKit and Firefox drop the whole
 * declaration (losing the blur too), so refraction must not be set there.
 * `CSS.supports` is not reliable for this, hence the engine sniff.
 */
export function supportsSvgBackdrop(): boolean {
  if (typeof navigator === 'undefined')
    return false
  const ua = navigator.userAgent
  return /Chrome\/|Chromium\//.test(ua) && !/Firefox\//.test(ua)
}

/** Dock background setting → the reusable glass utility (index.css). */
export const DOCK_GLASS_CLS: Record<DockBg, string> = {
  solid: 'glass-solid',
  frosted: 'glass-frosted',
  liquid: 'glass-liquid',
}

/**
 * Collapsed dock: full width but chrome-less, so only the handle icon shows.
 * Inline, so it beats the glass utility; the transition fades chrome back in.
 */
export const COLLAPSED_DOCK_STYLE: CSSProperties = {
  backgroundColor: 'transparent',
  backgroundImage: 'none',
  borderTopColor: 'transparent',
  boxShadow: 'none',
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
}

/**
 * Pure: dock sheet class + inline style for a background, opacity (0–100,
 * drives `--glass-opacity`) and mode. Tint is the drawer color.
 */
export function dockSurface(bg: DockBg, opacity: number, mode: ToolsDockMode): { className: string, style: CSSProperties } {
  const o = Math.min(100, Math.max(0, Math.round(Number.isFinite(opacity) ? opacity : 0)))
  const vars = { '--glass-tint': 'var(--drawerBg)', '--glass-opacity': `${o}%` } as CSSProperties
  if (mode === 'collapsed')
    return { className: DOCK_GLASS_CLS[bg], style: { ...vars, ...COLLAPSED_DOCK_STYLE } }
  return { className: DOCK_GLASS_CLS[bg], style: vars }
}
