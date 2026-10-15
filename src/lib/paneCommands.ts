import { activeWs, useStore } from '../store'
import { pickImageFiles } from './filePicker'
import { findLeaf } from './panes'

/**
 * The pick-and-place flows a pane can start, shared by the tools panel, the
 * empty pane's own button and the pane context menu. They read the store
 * through `getState` so a caller only ever passes the pane id.
 */

/** Default sticker origin: pane center, same as the sticker maker and file pick. */
export const STICKER_ORIGIN = 0.5

/** Import images and put the first one into the pane. */
export function pickPhotoForPane(paneId: string) {
  pickImageFiles((files) => {
    const s = useStore.getState()
    const first = s.addPhotos(files, false)[0]
    if (first)
      s.assign(paneId, first.id)
  })
}

/** Import images and pin each one onto the pane as a sticker, fanned out from the center. */
export function pickStickersForPane(paneId: string) {
  pickImageFiles((files) => {
    const s = useStore.getState()
    s.addPhotos(files, false).forEach((ph, i) => {
      const n = Math.min(0.8, STICKER_ORIGIN + i * 0.08)
      s.addSticker(paneId, ph.id, n, n)
    })
  })
}

/**
 * Whether `paneId` can take a sticker. Stickers pin onto an existing photo, so
 * an empty pane is not a valid target (matches `addSticker` in the store).
 */
export function paneCanTakeSticker(paneId: string): boolean {
  const s = useStore.getState()
  return !!findLeaf(activeWs(s).root, paneId)?.photoId
}

/**
 * Pin existing library photos onto a pane as stickers, fanned from center.
 * Returns false when the pane has no photo (callers should toast); otherwise
 * places every id and returns true.
 */
export function placeLibraryAsStickers(paneId: string, photoIds: string[]): boolean {
  if (!photoIds.length || !paneCanTakeSticker(paneId))
    return false
  const s = useStore.getState()
  photoIds.forEach((id, i) => {
    const n = Math.min(0.8, STICKER_ORIGIN + i * 0.08)
    s.addSticker(paneId, id, n, n)
  })
  return true
}

/** Add a text label to the pane and drop straight into editing it. */
export function addLabelToPane(paneId: string) {
  const s = useStore.getState()
  s.ensureLabel(paneId)
  s.requestLabelEdit(paneId)
}
