import type { CSSProperties } from 'react'
import type { DockBg } from '../store'
import { GLASS_SHADOW, glassBackdrop } from '../vendor/liquid-glass/liquid-glass'

/** SVG filter id used by the liquid style's displacement (Chromium only). */
export const LIQUID_FILTER_ID = 'koma-dock-liquid'

/**
 * Can `backdrop-filter: url(#svg)` actually refract? Only Chromium renders
 * SVG filters in backdrop-filter; Safari/WebKit and Firefox drop the whole
 * declaration (losing the blur too), so the liquid style must not include it
 * there. `CSS.supports` is not reliable for this, hence the engine sniff.
 */
export function supportsSvgBackdrop(): boolean {
  if (typeof navigator === 'undefined')
    return false
  const ua = navigator.userAgent
  return /Chrome\/|Chromium\//.test(ua) && !/Firefox\//.test(ua)
}

const tint = (pct: number) => `color-mix(in srgb, var(--drawerBg) ${pct}%, transparent)`

/**
 * Pure mapping from the dock background setting to inline sheet styles.
 * `opacity` (0–100) scales the tint/highlight of every style; the tools and
 * handle never fade (their legibility comes from `.tools-dock` CSS).
 */
export function dockBgStyle(bg: DockBg, opacity: number, svgBackdrop = false): CSSProperties {
  const o = Math.min(100, Math.max(0, Math.round(Number.isFinite(opacity) ? opacity : 0)))
  switch (bg) {
    case 'solid':
      return { backgroundColor: tint(o) }
    case 'frosted': {
      const f = 'blur(16px) saturate(140%)'
      return { backgroundColor: tint(o), backdropFilter: f, WebkitBackdropFilter: f }
    }
    case 'liquid': {
      // Chromium: vendored shuding/liquid-glass refraction (near-clear glass,
      // light tint). Elsewhere `url()` would void the whole declaration, so
      // fall back to blur + tint.
      if (svgBackdrop) {
        const f = glassBackdrop(LIQUID_FILTER_ID)
        return { backgroundColor: tint(Math.round(o * 0.5)), backdropFilter: f, boxShadow: GLASS_SHADOW }
      }
      const f = 'blur(12px) saturate(160%)'
      return { backgroundColor: tint(o), backdropFilter: f, WebkitBackdropFilter: f, boxShadow: GLASS_SHADOW }
    }
  }
}

/**
 * Collapsed dock: full width but chrome-less, so only the handle icon shows.
 * Overrides whatever `dockBgStyle` returned; the transition fades it back in.
 */
export const COLLAPSED_DOCK_STYLE: CSSProperties = {
  backgroundColor: 'transparent',
  backgroundImage: 'none',
  borderTopColor: 'transparent',
  boxShadow: 'none',
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
}
