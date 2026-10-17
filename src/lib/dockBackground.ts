import type { CSSProperties } from 'react'
import type { DockBg } from '../store'

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
 * Pure: dock sheet class + inline style for a background and opacity (0–100,
 * drives `--glass-opacity`). Tint is the drawer color. The sheet has no
 * chrome-less state any more (every display holds tools), so the tint is full
 * at rest and only the drag gesture (`--dock-drag-fade`) moves it.
 */
export function dockSurface(bg: DockBg, opacity: number): { className: string, style: CSSProperties } {
  const o = Math.min(100, Math.max(0, Math.round(Number.isFinite(opacity) ? opacity : 0)))
  const style = { '--glass-tint': 'var(--drawerBg)', '--glass-opacity': `${o}%` } as CSSProperties
  return { className: DOCK_GLASS_CLS[bg], style }
}

/**
 * Pure: background fade during a drag. Visible tools height above the handle
 * is `snapPoint - handleH - movementY` (movement is +down); 0 with no tools
 * showing, linear up to 1 at the tool row, held at 1 beyond (expanded).
 */
export function dockDragFade(snapPoint: number, movementY: number, rowH: number, handleH: number): number {
  if (!Number.isFinite(rowH) || rowH <= 0)
    return 1
  const t = (snapPoint - handleH - (Number.isFinite(movementY) ? movementY : 0)) / rowH
  return Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000
}
