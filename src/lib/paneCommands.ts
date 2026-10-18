import { activeWs, computeLayout, useStore } from '../store'
import { pickImageFiles } from './filePicker'

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

// Re-exported so the menu and the dock keep one import site for everything a
// pane can be told to do, while the layout/view commands stay in their own file.
export { duplicatePaneAuto, fitPanePhoto, matchCanvasToPhoto, resetPaneView, splitPane } from './paneLayoutCommands'
