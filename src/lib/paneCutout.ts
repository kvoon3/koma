import type { BgRemovalProgress } from './bgRemoval'
import type { Photo } from './imageStore'
import { activeWs, useStore } from '../store'
import { removeBackground } from './bgRemoval'
import { blurredCutoutFileName, cutoutFileName, originalOf, recordCutout } from './cutout'
import { bakeBlurredBackdrop } from './cutoutBackdrop'
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
 * The two frames a finished cutout was made of, held until its background
 * choice resolves: the pane's own preview (the exact pixels the model read)
 * and the cutout PNG. Session-only and one at a time, like the job: nothing
 * else can reach them, and the next cutout replaces them.
 */
let backdropSource: { cutoutId: string, photo: Blob, cutout: Blob } | null = null

/**
 * One-tap cutout of a pane's photo with the sticker maker's local model
 * (`removeBackground`). The cutout lands in the library as a new PNG and
 * replaces the pane's photo, keeping its zoom and focus; the original stays
 * in the library and the pane can go back to it (`restorePaneOriginal`).
 *
 * The model reads the decoded preview (≤1800px, already oriented and
 * HEIC-decoded), so the cutout is at most that size.
 *
 * The finished cutout then offers its background (`lib/cutoutBackdrop`): the
 * pane shows the transparent cutout straight away, as it always has, and a
 * chip on the pane can keep the photo's own frame behind it, blurred. Baking
 * that choice into a PNG is what keeps the rest of the app free of it: the
 * preview, the export and undo see a photo, like any other.
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
    const preview = await res.blob()
    const blob = await removeBackground(preview, (p) => {
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
      // The choice rides the cutout's own undo step (see `updateLeafJoined`):
      // picking a backdrop refines this cutout, it is not a second action.
      backdropSource = { cutoutId: cut.id, photo: preview, cutout: blob }
      now.patch({ cutoutBackdrop: { paneId, cutoutId: cut.id } })
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

/** Close the background choice without using it (the cutout stays transparent). */
export function dismissCutoutBackdrop() {
  backdropSource = null
  useStore.getState().patch({ cutoutBackdrop: null })
}

/**
 * Keep the blurred portrait backdrop under the cutout the pane is showing.
 *
 * The composite is baked into a NEW library photo (the cutout PNG stays), and
 * that photo replaces the cutout in this pane within the cutout's own undo
 * step: one undo leaves the cutout, the same way it did before the choice
 * existed, and the pane can still go back to the original from the tools.
 */
export async function applyBlurredBackdrop(): Promise<void> {
  const s = useStore.getState()
  const choice = s.cutoutBackdrop
  const src = backdropSource
  if (!choice || !src || src.cutoutId !== choice.cutoutId)
    return
  // One shot: the choice is consumed before the bake, so a double tap cannot
  // bake twice or race the swap.
  backdropSource = null
  s.patch({ cutoutBackdrop: null })
  const wsId = s.activeId
  const toastId = toastManager.add({ title: t('Blurring the background…'), timeout: 0 })
  try {
    const composite = await bakeBlurredBackdrop(src.photo, src.cutout)
    const now = useStore.getState()
    // Name it after the photo the subject was cut from, not after the cutout
    // that is already called `-cutout`: one suffix, one history.
    const from = now.photos.find(p => p.id === originalOf(now.cutouts, choice.cutoutId))
      ?? now.photos.find(p => p.id === choice.cutoutId)
    const file = new File([composite], blurredCutoutFileName(from?.name ?? 'photo.png'), { type: 'image/png' })
    const blurred = now.addPhotos([file], false)[0]
    if (!blurred)
      throw new Error(t('Could not add the blurred cutout to the library'))
    // The composite is a cutout too: Original keeps pointing at the photo the
    // subject was cut from, not at the transparent cutout in between.
    now.patch({ cutouts: recordCutout(now.cutouts, blurred.id, choice.cutoutId) })
    const live = useStore.getState()
    const leaf = live.activeId === wsId ? findLeaf(activeWs(live).root, choice.paneId) : null
    if (leaf?.photoId === choice.cutoutId) {
      live.updateLeafJoined(choice.paneId, { photoId: blurred.id })
      toastManager.update(toastId, { title: t('Kept the blurred background'), description: t('Tap Original in the tools to undo.'), timeout: 4000 })
    }
    else {
      toastManager.update(toastId, { title: t('Blurred cutout added to the library'), timeout: 4000 })
    }
  }
  catch (error) {
    console.error('[cutout-backdrop]', error)
    const detail = error instanceof Error ? error.message : String(error)
    toastManager.update(toastId, { title: t('Could not blur the background'), description: detail, timeout: 8000 })
  }
}

/** Put the original photo back into a cut-out pane (the cutout stays in the library). */
export function restorePaneOriginal(paneId: string, originalId: string) {
  useStore.getState().updateLeaf(paneId, { photoId: originalId })
}
