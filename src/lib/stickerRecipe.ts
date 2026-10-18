import type { Photo } from './imageStore'
import type { StickerMaterialType } from './sticker'
import type { StickerBakeStyle } from './stickerAssets'
import { folderOf } from './stickerLibrary'

/**
 * A made sticker's creation record: the original image it was started from, and
 * the controls it was saved with. The finished sticker is the other half of the
 * pair and needs no field of its own: it is this record's own `Photo.file`, the
 * composited PNG.
 *
 * That pair is what makes Re-edit mean editing again from the start rather than
 * tweaking the finished pixels: the stored original is the un-cut, un-edited
 * picture the user picked, so the maker can reopen it and re-run every step,
 * the AI cutout included, with the saved style as the starting values of the
 * controls.
 *
 * Two depths of editing, and the pair is the line between them:
 *
 * - Erase (alpha re-edit): the saved sticker is the composited PNG (cutout +
 *   border + perforation baked in), so its own alpha is a silhouette the mask
 *   editor can paint over. Works on ANY sticker, including every one made before
 *   this existed: it needs nothing but the record's pixels.
 * - Re-edit (full re-edit): only for a sticker that carries this record. The
 *   maker reopens on the ORIGINAL, re-cuts it, and loads the style as defaults.
 *
 * Both depths save a NEW record rather than replacing the asset: a placed copy
 * is a snapshot of the asset it was placed from (see lib/stickerLibrary), so
 * rewriting the PNG under it would change boards the user did not touch. The
 * old asset stays; the edit sits beside it in the same folder, carrying the
 * original forward so it stays re-editable.
 *
 * Legacy assets carry no record (`recipe` is absent, exactly like `kind` was
 * before the sticker library), so they offer Erase only; `stickerRecipeFrom`
 * validates untrusted input (a session record, an imported `.koma.json`) and
 * answers null for anything that is not complete.
 */

/**
 * Longest edge the stored original keeps. The bake works at `INSERT_MAX`
 * (960px), so a 960px original would reopen the maker with a pre-shrunk
 * subject; the value here is chosen by measurement (see DESIGN.md): the fresh
 * file, a 960px original and a 1600px original are re-cut and re-baked, and the
 * smallest size whose output is indistinguishable from the fresh decode wins.
 * The cap exists because this is bytes in the session record: a phone photo is
 * megabytes, and a sticker library of dozens of them must still autosave.
 */
export const ORIGINAL_MAX = 1600

/** Photos keep their own bytes' character: photographic sources shrink far better as JPEG. */
const JPEG_QUALITY = 0.92

/**
 * What the user started from.
 *
 * A text sticker has no original image: its spec IS the original, and Re-edit
 * reopens the same seeded controls.
 */
export type StickerOriginal
  = | {
    type: 'text'
    text: string
    color: string
    /** A `FONTS` id in the maker dialog; an unknown id falls back to the first. */
    fontId: string
  }
  | {
    type: 'image'
    /**
     * The ORIGINAL picture, as a data URL (long edge ≤ `ORIGINAL_MAX`): the
     * uncut, unedited pick, never the cutout or the composed result.
     */
    src: string
    name: string
    /** The library photo it was picked from, when it was one (provenance). */
    photoId?: string
  }

export interface StickerRecipe {
  /** The picture (or text spec) the sticker was started from. */
  original: StickerOriginal
  /** The controls it was saved with, which a re-edit loads as defaults. */
  style: StickerBakeStyle
}

/**
 * What the maker hands the save: a text spec is already an original, an image
 * arrives either as the freshly picked File (encode it now) or as the original a
 * re-edit is carrying forward (already encoded, pass it through).
 */
export type StickerOriginalInput
  = | { type: 'text', text: string, color: string, fontId: string }
    | { type: 'image', file: File, name: string, photoId?: string }
    | { type: 'image', src: string, name: string, photoId?: string }

/** A recipe read from untrusted input is only a recipe when every field is there. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

const MATERIALS: readonly StickerMaterialType[] = ['original', 'holographic', 'glitter']

/** The stamp sliders' design, or null for the plain die-cut border. */
function asPerforation(value: unknown): { ok: true, design: StickerBakeStyle['perforation'] } | { ok: false } {
  if (value == null)
    return { ok: true, design: null }
  const record = asRecord(value)
  const depth = asNumber(record?.depth)
  const spacing = asNumber(record?.spacing)
  if (depth == null || spacing == null)
    return { ok: false }
  return { ok: true, design: { depth, spacing } }
}

function asStyle(value: unknown): StickerBakeStyle | null {
  const record = asRecord(value)
  if (!record)
    return null
  const outlineWidth = asNumber(record.outlineWidth)
  const outlineColor = asString(record.outlineColor)
  const baseName = asString(record.baseName)
  const displayLongEdge = asNumber(record.displayLongEdge)
  const material = asString(record.material) as StickerMaterialType | null
  const perforation = asPerforation(record.perforation)
  if (outlineWidth == null || outlineColor == null || baseName == null || displayLongEdge == null)
    return null
  if (!material || !MATERIALS.includes(material) || !perforation.ok)
    return null
  return { outlineWidth, outlineColor, material, baseName, perforation: perforation.design, displayLongEdge }
}

function asOriginal(value: unknown): StickerOriginal | null {
  const record = asRecord(value)
  if (!record)
    return null
  if (record.type === 'text') {
    const text = asString(record.text)
    const color = asString(record.color)
    const fontId = asString(record.fontId)
    return text && color && fontId ? { type: 'text', text, color, fontId } : null
  }
  if (record.type === 'image') {
    const src = asString(record.src)
    const name = asString(record.name)
    if (!src || !name)
      return null
    const photoId = asString(record.photoId)
    return photoId ? { type: 'image', src, name, photoId } : { type: 'image', src, name }
  }
  return null
}

/**
 * A recipe from untrusted input: a session record written by an older build, an
 * imported `.koma.json`, or something malformed. Absent or incomplete reads as
 * null, which is the legacy asset state: Erase, no Re-edit.
 */
export function stickerRecipeFrom(value: unknown): StickerRecipe | null {
  const record = asRecord(value)
  const original = asOriginal(record?.original)
  const style = asStyle(record?.style)
  return original && style ? { original, style } : null
}

/** The recipe a sticker was made with, or null when it has none (or an invalid one). */
export function recipeOf(photo: Photo): StickerRecipe | null {
  return stickerRecipeFrom(photo.recipe)
}

/**
 * Photos with only complete recipes kept: hydration is the one door every
 * stored photo comes through (a session in IndexedDB, a `.koma.json` someone
 * may have edited by hand), so a record whose recipe lost a field there falls
 * back to the legacy state instead of feeding half a style to a bake. The
 * mirror of `normalizePhotoKinds` for the re-edit door.
 */
export function normalizePhotoRecipes(photos: Photo[]): Photo[] {
  return photos.map((p) => {
    if (!p.recipe)
      return p
    const recipe = recipeOf(p)
    return recipe ? { ...p, recipe } : { ...p, recipe: undefined }
  })
}

/** A text sticker's original: the spec itself, already complete. */
export function textOriginal(text: string, color: string, fontId: string): StickerOriginal {
  return { type: 'text', text, color, fontId }
}

/**
 * The original picture at a size the session can hold, as a data URL, or null
 * when the file cannot be decoded (a save then lands a sticker with no recipe:
 * Erase only, never a failed make).
 *
 * `maxEdge` is the long edge it keeps. It defaults to `ORIGINAL_MAX`; the
 * measurement that chose that number passes its own sizes through here.
 */
export async function captureOriginal(file: File, maxEdge: number = ORIGINAL_MAX): Promise<string | null> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
  }
  catch {
    return null
  }
  finally {
    URL.revokeObjectURL(url)
  }
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight)
  if (longEdge <= 0)
    return null
  const scale = Math.min(1, maxEdge / longEdge)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context)
    return null
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  // A source that may carry alpha keeps PNG; a photo keeps its own character as
  // JPEG, which is several times smaller for the same picture (DESIGN.md).
  const keepsAlpha = /^image\/(?:png|webp|avif|gif)/.test(file.type)
  const dataUrl = keepsAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  canvas.width = 0
  canvas.height = 0
  return dataUrl
}

/**
 * The recipe for a sticker about to be saved: a text spec passes through, a
 * freshly picked File is captured to its own data URL, and an original carried
 * forward by a re-edit is kept byte for byte (it is already the original, and a
 * second encode would only cost generation loss). Null when the subject cannot
 * be read back, which costs the sticker its Re-edit door but never the save.
 */
export async function buildStickerRecipe(
  original: StickerOriginalInput,
  style: StickerBakeStyle,
): Promise<StickerRecipe | null> {
  if (original.type === 'text')
    return { original: textOriginal(original.text, original.color, original.fontId), style }
  if ('file' in original) {
    const src = await captureOriginal(original.file)
    if (!src)
      return null
    const { name, photoId } = original
    return { original: photoId ? { type: 'image', src, name, photoId } : { type: 'image', src, name }, style }
  }
  // Already an original: hand it back untouched, not re-shaped.
  return { original, style }
}

/**
 * Where an edited copy of `photo` lands: the same folder it was filed in (an
 * edit never re-files the sticker) and a name that says what happened to it,
 * so the library never shows two identical-looking entries side by side.
 * `folderOf` answers '' for Unsorted, which is what both callers want.
 */
export function editedStickerMeta(photo: Photo, depth: 'erased' | 'rebaked'): { folder: string, baseName: string } {
  const stem = photo.name.replace(/\.[^.]+$/, '') || 'sticker'
  return {
    folder: folderOf(photo),
    baseName: depth === 'erased' ? `${stem} (erased)` : `${stem} (edited)`,
  }
}
