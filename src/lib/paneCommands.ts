import { activeWs, computeLayout, MIN_ZOOM, useStore } from '../store'
import { pickImageFiles } from './filePicker'

/**
 * The pick-and-place flows a pane can start, shared by the tools panel, the
 * empty pane's own button and the pane context menu. They read the store
 * through `getState` so a caller only ever passes the pane id.
 */

/** Import images and put the first one into the pane. */
export function pickPhotoForPane(paneId: string) {
  pickImageFiles((files) => {
    const s = useStore.getState()
    const first = s.addPhotos(files, false)[0]
    if (first)
      s.assign(paneId, first.id)
  })
}

/** Import images and pin each one as a board sticker, fanned near the canvas center. */
export function pickStickersForPane(_paneId: string) {
  pickImageFiles((files) => {
    const s = useStore.getState()
    s.addPhotos(files, false).forEach((ph, i) => {
      const n = Math.min(0.8, 0.5 + i * 0.08)
      s.addSticker(ph.id, n, n)
    })
  })
}

/**
 * Add a board-level text label centered on the pane and drop straight into
 * editing it. The label belongs to the whole board, so it can then be dragged
 * across panes.
 */
export function addLabelToPane(paneId: string) {
  const s = useStore.getState()
  const ws = activeWs(s)
  const view = computeLayout(ws.root, ws.canvasRatio, ws.canvasFill, 1000, 1000, 0, 0, 0)
  const cell = view.leaves.find(l => l.node.id === paneId)?.rect
  const x = cell ? (cell.x + cell.w / 2) / view.W : 0.5
  const y = cell ? (cell.y + cell.h / 2) / view.H : 0.5
  s.requestLabelEdit(s.addLabel(x, y))
}

/*
 * Pane-scoped layout and view commands, shared by the desktop context menu
 * (PaneMenu) and the mobile tools dock (Stage). Each reads the pane's current
 * geometry from the store so a caller only passes the id.
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
