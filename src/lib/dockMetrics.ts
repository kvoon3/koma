import type { ToolsDockMode } from '../store'

/**
 * The heights the dock measures and publishes to the routes, so a route can lay
 * its stage out against the real sheet instead of a constant. `footerH` is the
 * status strip pinned under the sheet.
 */
export interface DockMetrics {
  iconH: number
  rowH: number
  expH: number
  footerH: number
}

/** The sheet's handle. Keep in sync with `handleCls` in components/ToolsDock. */
export const DOCK_HANDLE_H = 28

/** First-frame values before the sheet has measured; compact is 107. */
export const DOCK_METRICS_FALLBACK: DockMetrics = { iconH: 48, rowH: 72, expH: 72, footerH: 31 }

/** The band a display covers at the bottom of the stage, handle to footer. */
export function dockBand(metrics: DockMetrics, mode: ToolsDockMode): number {
  const content = mode === 'icons' ? metrics.iconH : mode === 'row' ? metrics.rowH : metrics.expH
  return DOCK_HANDLE_H + content + metrics.footerH
}

/** The band the icon-only display covers: the groups page's floor. */
export function compactDockBand(metrics: DockMetrics): number {
  return DOCK_HANDLE_H + metrics.iconH + metrics.footerH
}
