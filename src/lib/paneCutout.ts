import type { BgRemovalProgress } from './bgRemoval'
import type { CutoutState, CutoutVariants } from './cutoutVariants'
import type { Photo } from './imageStore'
import { activeWs, useStore } from '../store'
import { removeBackground } from './bgRemoval'
import { blurredCutoutFileName, cutoutFileName, recordCutout } from './cutout'
import { bakeBlurredBackdrop } from './cutoutBackdrop'
import { recordBlurredSet, recordCutoutSet, variantsOf } from './cutoutVariants'
import { t } from './i18n'
import { getPreview } from './imageStore'
import { findLeaf } from './panes'
import { toastManager } from './toast'

/** Toast line for a running cutout. */
function progressTitle(p: BgRemovalProgress): string {
  const pct = p.progress != null ? ` ${Math.round(p.progress)}%` : ''
  return p.phase === 'loading' ? `${t('Loading the cutout model…')}${pct}` : t('Cutting out…')
}

/** Is `photoId` in the library (an orphaned snapshot still counts: it still renders)? */
function hasPhoto(photoId: string): boolean {
  return useStore.getState().photos.some(p => p.id === photoId)
}

function photoById(photoId: string): Photo | null {
  return useStore.getState().photos.find(p => p.id === photoId) ?? null
}

/**
 * The cutout PNG of `source`, running the local U²-Netp model when the library
 * does not have one yet. The model reads the source's decoded preview (≤1800px,
 * already oriented and HEIC-decoded), so the cutout is at most that size.
 */
async function ensureCutout(source: Photo, paneId: string): Promise<string> {
  const { patch } = useStore.getState()
  patch({ cutoutJob: { paneId, phase: 'loading' } })
  const toastId = toastManager.add({ title: t('Cutting out…'), timeout: 0 })
  try {
    const pv = await getPreview(source)
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
    const cut = s.addPhotos([new File([blob], cutoutFileName(source.name), { type: 'image/png' })], false)[0]
    if (!cut)
      throw new Error(t('Could not add the cutout to the library'))
    s.patch({
      cutouts: recordCutout(s.cutouts, cut.id, source.id),
      cutoutSets: recordCutoutSet(s.cutoutSets, source.id, cut.id),
    })
    toastManager.update(toastId, { title: t('Background removed'), timeout: 2500 })
    return cut.id
  }
  catch (error) {
    console.error('[cutout]', error)
    const detail = error instanceof Error ? error.message : String(error)
    toastManager.update(toastId, { title: t('Background removal failed'), description: detail, timeout: 8000 })
    throw error
  }
  finally {
    useStore.getState().patch({ cutoutJob: null })
  }
}

/**
 * The blurred composite of `source`: its cutout PNG over its own frame,
 * blurred (see `lib/cutoutBackdrop`). Baked on demand, because the two halves
 * are library assets and always can be rebuilt: the source's preview and the
 * cutout PNG that the model left in the library.
 */
async function ensureBlurred(source: Photo, cutoutId: string): Promise<string> {
  const toastId = toastManager.add({ title: t('Blurring the background…'), timeout: 0 })
  try {
    const cutout = photoById(cutoutId)
    if (!cutout)
      throw new Error(t('Could not read this photo'))
    const pv = await getPreview(source)
    if (!pv?.url)
      throw new Error(t('Could not read this photo'))
    const res = await fetch(pv.url)
    if (!res.ok)
      throw new Error(t('Could not read this photo'))
    const composite = await bakeBlurredBackdrop(await res.blob(), cutout.file)
    const s = useStore.getState()
    const file = new File([composite], blurredCutoutFileName(source.name), { type: 'image/png' })
    const blurred = s.addPhotos([file], false)[0]
    if (!blurred)
      throw new Error(t('Could not add the blurred cutout to the library'))
    // A composite is a cutout too: Original still resolves to the photo the
    // subject was cut from, never to the transparent PNG in between.
    s.patch({
      cutouts: recordCutout(s.cutouts, blurred.id, cutoutId),
      cutoutSets: recordBlurredSet(s.cutoutSets, source.id, cutoutId, blurred.id),
    })
    toastManager.update(toastId, { title: t('Kept the blurred background'), timeout: 2000 })
    return blurred.id
  }
  catch (error) {
    console.error('[cutout-backdrop]', error)
    const detail = error instanceof Error ? error.message : String(error)
    toastManager.update(toastId, { title: t('Could not blur the background'), description: detail, timeout: 8000 })
    throw error
  }
}

/** The library asset a cutout target needs, running the model / bake only when it is missing. */
async function variantPhotoFor(paneId: string, target: 'cutout' | 'blurred', variants: CutoutVariants): Promise<string> {
  const source = variants.source
  const sourcePhoto = source ? photoById(source) : null
  if (!source || !sourcePhoto)
    throw new Error(t('The original photo is gone'))
  const cutoutId = variants.cutout ?? await ensureCutout(sourcePhoto, paneId)
  if (target === 'cutout')
    return cutoutId
  return variants.blurred ?? await ensureBlurred(sourcePhoto, cutoutId)
}

/** Hand the pane the resolved photo, or say where it went if the pane moved on meanwhile. */
function swapPanePhoto(paneId: string, fromId: string, toId: string, wsId: string, target: CutoutState) {
  const now = useStore.getState()
  const leaf = now.activeId === wsId ? findLeaf(activeWs(now).root, paneId) : null
  if (leaf?.photoId === fromId) {
    now.updateLeaf(paneId, { photoId: toId })
    return
  }
  toastManager.add({ title: target === 'blurred' ? t('Blurred cutout added to the library') : t('Cutout added to the library'), timeout: 4000 })
}

/**
 * Put one of a photo's three states into its pane, from the dock's Cut out
 * menu (Original, Transparent or Blurred background).
 *
 * Switching is a plain `photoId` swap, so it is ONE committed undo step, and
 * it is instant whenever the asset exists: the cutout PNG and the blurred
 * composite are library photos (see `lib/cutoutVariants` for the graph). Only
 * the first visit to Transparent or Blurred runs the model (and, for Blurred,
 * the bake) with the pane's progress veil.
 */
export async function applyCutoutState(paneId: string, photo: Photo, target: CutoutState): Promise<void> {
  const start = useStore.getState()
  // One cutout at a time: the progress veil and the worker are single-flight.
  if (start.cutoutJob)
    return
  const variants = variantsOf(start.cutouts, start.cutoutSets, photo.id, hasPhoto)
  if (target === 'original') {
    if (!variants.source) {
      toastManager.add({ title: t('The original photo is gone'), timeout: 4000 })
      return
    }
    if (variants.source !== photo.id)
      useStore.getState().updateLeaf(paneId, { photoId: variants.source })
    return
  }
  try {
    const nextId = await variantPhotoFor(paneId, target, variants)
    swapPanePhoto(paneId, photo.id, nextId, start.activeId, target)
  }
  catch (error) {
    // The step that failed has toasted its own reason (see `ensureCutout` /
    // `ensureBlurred`); the pane simply did not change.
    console.error('[cutout]', error)
  }
}
