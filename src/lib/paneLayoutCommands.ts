import { activeWs, computeLayout, MIN_ZOOM, useStore } from '../store'

/**
 * The pane-scoped layout and view commands: split, duplicate, reset the view,
 * fit the photo, match the canvas to it. Shared by the desktop context menu
 * (PaneMenu) and the mobile tools dock (Stage). Each reads the pane's current
 * geometry from the store so a caller only passes the id, exactly like the
 * pick-and-place flows in `lib/paneCommands` (which re-exports these).
 */

function paneCell(paneId: string) {
  const s = useStore.getState()
  const ws = activeWs(s)
  const view = computeLayout(ws.root, ws.canvasRatio, ws.canvasFill, 1000, 1000, 0, 0, 0)
  const hit = view.leaves.find(l => l.node.id === paneId)
  return hit ? { leaf: hit.node, rect: hit.rect } : null
}

/** Split the pane in two: 'column' is top/bottom, 'row' is left/right. */
export function splitPane(paneId: string, dir: 'row' | 'column') {
  useStore.getState().split(paneId, dir)
}

/** Duplicate toward the longer side, so neither half becomes a sliver. */
export function duplicatePaneAuto(paneId: string, rect?: { w: number, h: number }) {
  const r = rect ?? paneCell(paneId)?.rect
  useStore.getState().duplicatePane(paneId, !r || r.w >= r.h ? 'row' : 'column')
}

/** Double-click's action: zoom 1 is cover, centered. */
export function resetPaneView(paneId: string) {
  useStore.getState().updateLeaf(paneId, { zoom: 1, cx: 0.5, cy: 0.5 })
}

/**
 * Contain the whole photo: the ratio of the contain and cover scales, floored
 * at the shared zoom floor so extreme ratios stay legible.
 */
export function fitPanePhoto(paneId: string, iw: number, ih: number, rect?: { w: number, h: number }) {
  const r = rect ?? paneCell(paneId)?.rect
  if (!r || !iw || !ih)
    return
  const cover = Math.max(r.w / iw, r.h / ih)
  const contain = Math.min(r.w / iw, r.h / ih)
  useStore.getState().updateLeaf(paneId, { zoom: Math.max(MIN_ZOOM, contain / cover), cx: 0.5, cy: 0.5 })
}

/** Reshape the canvas to the photo's own aspect ratio. */
export function matchCanvasToPhoto(trueW: number, trueH: number) {
  if (!trueW || !trueH)
    return
  const s = useStore.getState()
  s.setCanvasSize(trueW / trueH, activeWs(s).canvasFill)
}
