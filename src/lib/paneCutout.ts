import type { BgRemovalProgress } from './bgRemoval'
import type { Photo } from './imageStore'
import { activeWs, useStore } from '../store'
import { removeBackground } from './bgRemoval'
import { cutoutFileName, recordCutout } from './cutout'
import { t } from './i18n'
import { getPreview } from './imageStore'
import { findLeaf } from './panes'
import { toastManager } from './toast'

/** Toast line for a running cutout. */
function progressTitle(p: BgRemovalProgress): string {
  const pct = p.progress != null ? ` ${Math.round(p.progress)}%` : ''
  return p.phase === 'loading' ? `${t('Loading the cutout model…')}${pct}` : t('Cutting out…')
}

/**
 * One-tap cutout of a pane's photo with the sticker maker's local model
 * (`removeBackground`). The cutout lands in the library as a new PNG and
 * replaces the pane's photo, keeping its zoom and focus; the original stays
 * in the library and the pane can go back to it (`restorePaneOriginal`).
 *
 * The model reads the decoded preview (≤1800px, already oriented and
 * HEIC-decoded), so the cutout is at most that size.
 */
export async function cutOutPane(paneId: string, photo: Photo): Promise<void> {
  const { patch } = useStore.getState()
  if (useStore.getState().cutoutJob)
    return
  const wsId = useStore.getState().activeId
  patch({ cutoutJob: { paneId, phase: 'loading' } })
  const toastId = toastManager.add({ title: t('Cutting out…'), timeout: 0 })
  try {
    const pv = await getPreview(photo)
    if (!pv?.url)
      throw new Error(t('Could not read this photo'))
    const res = await fetch(pv.url)
    if (!res.ok)
      throw new Error(t('Could not read this photo'))
    const blob = await removeBackground(await res.blob(), (p) => {
      patch({ cutoutJob: { paneId, phase: p.phase, progress: p.progress } })
      toastManager.update(toastId, { title: progressTitle(p) })
    })
    const s = useStore.getState()
    const cut = s.addPhotos([new File([blob], cutoutFileName(photo.name), { type: 'image/png' })], false)[0]
    if (!cut)
      throw new Error(t('Could not add the cutout to the library'))
    s.patch({ cutouts: recordCutout(s.cutouts, cut.id, photo.id) })
    // Only swap if the pane still shows the photo that was cut out; otherwise
    // the cutout simply waits in the library.
    const now = useStore.getState()
    const leaf = now.activeId === wsId ? findLeaf(activeWs(now).root, paneId) : null
    if (leaf?.photoId === photo.id) {
      now.updateLeaf(paneId, { photoId: cut.id })
      toastManager.update(toastId, { title: t('Background removed'), description: t('Tap Original in the tools to undo.'), timeout: 5000 })
    }
    else {
      toastManager.update(toastId, { title: t('Cutout added to the library'), timeout: 4000 })
    }
  }
  catch (error) {
    console.error('[cutout]', error)
    const detail = error instanceof Error ? error.message : String(error)
    toastManager.update(toastId, { title: t('Background removal failed'), description: detail, timeout: 8000 })
  }
  finally {
    useStore.getState().patch({ cutoutJob: null })
  }
}

/** Put the original photo back into a cut-out pane (the cutout stays in the library). */
export function restorePaneOriginal(paneId: string, originalId: string) {
  useStore.getState().updateLeaf(paneId, { photoId: originalId })
}
