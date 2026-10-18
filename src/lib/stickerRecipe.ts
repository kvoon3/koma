import type { Photo } from './imageStore'
import type { StickerMaterialType } from './sticker'
import type { StickerBakeStyle } from './stickerAssets'
import { folderOf } from './stickerLibrary'

/**
 * A made sticker's creation recipe: the subject the bake consumed and the
 * values the maker's controls held at that moment. It is what lets the sticker
 * library reopen the REAL maker over an existing sticker and re-bake it.
 *
 * Two depths of re-editing, and the recipe is the line between them:
 *
 * - **Alpha re-edit** ("Erase"): the saved sticker is the composited PNG
 *   (cutout + border + perforation baked in), so its own alpha is a silhouette
 *   the mask editor can paint over. Works on ANY sticker, including every one
 *   made before this lane: it needs nothing but the record's pixels.
 * - **Full re-bake** ("Re-edit"): only for a sticker that carries a recipe. The
 *   maker reopens with the subject and the controls it was saved with, so the
 *   outline, the stamp teeth and the material are editable again as controls
 *   rather than as pixels.
 *
 * Both paths save a NEW record rather than replacing the asset: a placed copy
 * is a snapshot of the asset it was placed from (see lib/stickerLibrary), so
 * rewriting the PNG under it would change boards the user did not touch. The
 * old asset stays; the edit sits beside it in the same folder.
 *
 * Legacy assets carry no recipe (`recipe` is absent, exactly like `kind` was
 * before the library lane), so they offer Erase only; `stickerRecipeFrom`
 * validates untrusted input (a session record, an imported .koma.json) and
 * answers null for anything that is not a complete recipe.
 */

/**
 * Longest edge of the stored source PNG: the bake's own working size
 * (`INSERT_MAX` in lib/stickerAssets). The recipe holds pixels rather than a
 * pointer so a re-bake reopens the subject the sticker was actually made from
 * (a manual cutout included) without a second model run, and it survives the
 * source object URL, the dialog's unmount and a reload. The cost is one more
 * PNG the size of the sticker itself, per re-editable sticker.
 */
export const RECIPE_SOURCE_MAX = 960

/** Where a sticker's subject came from, as the maker needs it to reopen. */
export type StickerRecipeSource
  = | {
    type: 'text'
    text: string
    color: string
    /** A `FONTS` id in the maker dialog; an unknown id falls back to the first. */
    fontId: string
  }
  | {
    type: 'image'
    /** The subject the bake consumed, as a PNG data URL (see RECIPE_SOURCE_MAX). */
    src: string
    name: string
    /** The library photo it was picked from, when it was one (provenance). */
    photoId?: string
  }

export interface StickerRecipe {
  source: StickerRecipeSource
  style: StickerBakeStyle
}

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

function asSource(value: unknown): StickerRecipeSource | null {
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
 * A recipe from untrusted input: a session record written by an older build,
 * an imported `.koma.json`, or something malformed. Absent or incomplete reads
 * as null, which is the legacy asset state: Erase, no Re-edit.
 */
export function stickerRecipeFrom(value: unknown): StickerRecipe | null {
  const record = asRecord(value)
  const source = asSource(record?.source)
  const style = asStyle(record?.style)
  return source && style ? { source, style } : null
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

/**
 * The subject at the bake's own working size, as a PNG data URL. Re-encoding
 * through a canvas is what makes the recipe self-contained: the maker's source
 * may be an object URL of the cutout blob (dead after the dialog closes) or a
 * mask editor data URL at its own resolution. Null when the image cannot be
 * decoded, so a save still lands a sticker, just without its recipe.
 */
export async function captureRecipeSource(src: string): Promise<string | null> {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  try {
    await image.decode()
  }
  catch {
    return null
  }
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight)
  if (longEdge <= 0)
    return null
  const scale = Math.min(1, RECIPE_SOURCE_MAX / longEdge)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context)
    return null
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/png')
  canvas.width = 0
  canvas.height = 0
  return url
}

/**
 * The recipe for a sticker about to be saved: a text source is already
 * complete, an image source is captured to its own data URL. Null when the
 * subject cannot be read back, which costs the sticker its re-edit door but
 * never the save.
 */
export async function buildStickerRecipe(
  source: StickerRecipeSource,
  style: StickerBakeStyle,
): Promise<StickerRecipe | null> {
  if (source.type === 'text')
    return { source, style }
  const src = await captureRecipeSource(source.src)
  return src ? { source: { ...source, src }, style } : null
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
