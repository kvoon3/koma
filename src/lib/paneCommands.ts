import { activeWs, computeLayout, useStore } from '../store'
import { pickImageFiles } from './filePicker'
import { findLeaf } from './panes'
import { formatCoords, placeName } from './regeo'

/**
 * The pick-and-place flows a pane can start: open the file picker and put what
 * it returns into the pane, onto the board, or into label editing. Shared by
 * the tools panel, the empty pane's own button and the pane context menu. They
 * read the store through `getState` so a caller only ever passes the pane id.
 *
 * The pane's layout and view commands (split, duplicate, fit, …) are a
 * different job and live in `lib/paneLayoutCommands`.
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

/** The pane's center in board-normalized coords (0.5, 0.5 when it is gone). */
function paneCenter(paneId: string): { x: number, y: number } {
  const s = useStore.getState()
  const ws = activeWs(s)
  const view = computeLayout(ws.root, ws.canvasRatio, ws.canvasFill, 1000, 1000, 0, 0, 0)
  const cell = view.leaves.find(l => l.node.id === paneId)?.rect
  return {
    x: cell ? (cell.x + cell.w / 2) / view.W : 0.5,
    y: cell ? (cell.y + cell.h / 2) / view.H : 0.5,
  }
}

/**
 * Add a board-level text label centered on the pane and drop straight into
 * editing it. The label belongs to the whole board, so it can then be dragged
 * across panes.
 */
export function addLabelToPane(paneId: string) {
  const s = useStore.getState()
  const { x, y } = paneCenter(paneId)
  s.requestLabelEdit(s.addLabel(x, y))
}

/**
 * Insert the focused pane's photo location as a new board label: a pin icon
 * and the district name ("Hangzhou Xihu"), or the plain WGS-84 pair when the
 * offline lookup has no polygon there. The reverse geocode is async (the
 * district JSON is lazy), so the insert waits for it; the label is added in one
 * commit, which the board's undo treats as one step.
 */
export function insertLocationLabel(paneId: string) {
  const s = useStore.getState()
  const ws = activeWs(s)
  const leaf = findLeaf(ws.root, paneId)
  const gps = (leaf?.photoId ? s.photos.find(p => p.id === leaf.photoId) : undefined)?.gps
  if (!gps)
    return
  const spot = paneCenter(paneId)
  const wsId = ws.id
  void placeName(gps.lat, gps.lng).then((name) => {
    const now = useStore.getState()
    // The lookup can outlive the board it started on: do not drop a label into
    // a workspace the user has since switched away from, and re-check the pane
    // still shows the same photo (and fix).
    if (now.activeId !== s.activeId || activeWs(now).id !== wsId)
      return
    const leafNow = findLeaf(activeWs(now).root, paneId)
    const photoNow = leafNow?.photoId ? now.photos.find(p => p.id === leafNow.photoId) : undefined
    if (photoNow?.gps?.lat !== gps.lat || photoNow?.gps?.lng !== gps.lng)
      return
    now.addLabel(spot.x, spot.y, {
      text: name ?? formatCoords(gps.lat, gps.lng),
      icon: 'pin',
    })
  })
}

// Re-exported so the menu and the dock keep one import site for everything a
// pane can be told to do, while the layout/view commands stay in their own file.
export { duplicatePaneAuto, fitPanePhoto, matchCanvasToPhoto, resetPaneView, splitPane } from './paneLayoutCommands'
