import type { Action } from './actionGuard'

/**
 * One-tap pane cutout: pure bookkeeping (unit-tested). The side effects
 * (model run, library insert, pane swap) live in `paneCutout`.
 *
 * A cutout is a new library photo; `CutoutMap` maps its id to the photo it
 * was cut from, so any pane showing it (after a swap, copy or duplicate) can
 * go back to the original, which never leaves the library.
 */
export type CutoutMap = Record<string, string>

/** The chosen name without its extension; a nameless file is still a photo. */
function baseName(name: string): string {
  return name.replace(/\.[^./]+$/, '') || 'photo'
}

/** `IMG_1234.HEIC` → `IMG_1234-cutout.png` (always a PNG: it carries alpha). */
export function cutoutFileName(name: string): string {
  return `${baseName(name)}-cutout.png`
}

/**
 * `IMG_1234.HEIC` → `IMG_1234-cutout-blur.png`: the cutout with its blurred
 * backdrop baked in (see `lib/cutoutBackdrop`). Still a cutout, since the
 * Original tool and the library read it as one, so the name says what it kept.
 */
export function blurredCutoutFileName(name: string): string {
  return `${baseName(name)}-cutout-blur.png`
}

/** The photo `photoId` was cut from, or null when it is not a cutout. */
export function originalOf(map: CutoutMap, photoId: string | null | undefined): string | null {
  return (photoId && map[photoId]) || null
}

/** Record a finished cutout; cutting a cutout again still points at the first original. */
export function recordCutout(map: CutoutMap, cutoutId: string, fromId: string): CutoutMap {
  return { ...map, [cutoutId]: originalOf(map, fromId) ?? fromId }
}

/**
 * The dock's Cut out action: requires a photo, and is unavailable while a
 * cutout is running or when the pane already shows a cutout (that pane offers
 * Original instead).
 */
export function cutoutAction<P extends { id: string }>(
  state: { cutouts: CutoutMap, busy: boolean },
  run: (paneId: string, photo: P) => void,
): Action<P> {
  return {
    requires: 'photo',
    when: t => !state.busy && !originalOf(state.cutouts, t.photo.id),
    run: t => run(t.paneId, t.photo),
  }
}

/** Restore the original photo of a cut-out pane; requires a photo that is a cutout. */
export function restoreOriginalAction<P extends { id: string }>(
  state: { cutouts: CutoutMap, has: (photoId: string) => boolean },
  run: (paneId: string, originalId: string) => void,
): Action<P> {
  const orig = (p: P) => originalOf(state.cutouts, p.id)
  return {
    requires: 'photo',
    when: (t) => {
      const o = orig(t.photo)
      return !!o && state.has(o)
    },
    run: t => run(t.paneId, orig(t.photo)!),
  }
}
