import type { CSSProperties } from 'react'
import type { DockBg } from '../store'

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
      const base = 'blur(10px) saturate(180%) brightness(1.05)'
      const hi = (o / 100) * 0.55 + 0.15
      return {
        backgroundColor: tint(Math.round(o * 0.6)),
        backgroundImage: `linear-gradient(180deg, rgba(255,255,255,${(hi * 0.5).toFixed(3)}) 0%, rgba(255,255,255,0) 45%)`,
        // WebKit gets the plain blur; only Chromium gets the refraction.
        WebkitBackdropFilter: base,
        backdropFilter: svgBackdrop ? `url(#${LIQUID_FILTER_ID}) ${base}` : base,
        borderTopColor: `rgba(255,255,255,${hi.toFixed(3)})`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,${hi.toFixed(3)}), inset 0 -1px 0 rgba(0,0,0,${(hi * 0.25).toFixed(3)}), inset 0 8px 16px -10px rgba(255,255,255,${(hi * 0.6).toFixed(3)}), 0 -8px 24px -12px rgba(0,0,0,0.25)`,
      }
    }
    case 'transparent':
      // No sheet; opacity drives the per-button chips (see index.css).
      return { 'backgroundColor': 'transparent', 'borderTopColor': 'transparent', 'boxShadow': 'none', '--dock-chip': tint(o) } as CSSProperties
  }
}
