import { useStore } from '../store'
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

/** Add a text label to the pane and drop straight into editing it. */
export function addLabelToPane(paneId: string) {
  const s = useStore.getState()
  s.ensureLabel(paneId)
  s.requestLabelEdit(paneId)
}
