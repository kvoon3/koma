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
