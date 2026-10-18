import type { Photo } from './imageStore'
import type { StickerMaterialType, StickerSource } from './sticker'
import type { PerforationDesign } from './stickerFX'
import type { StickerOriginalInput } from './stickerRecipe'
import { useStore } from '../store'
import { makeSticker } from './sticker'
import { buildStickerRecipe, editedStickerMeta } from './stickerRecipe'
import { say } from './toast'
import { dataUrlToFile } from './workspaceFile'

/**
 * What happens to a sticker once the maker has drawn it. This is the one step
 * the maker dialog does not own itself: the dialog collects the inputs (text or
 * pick, cutout, edge, material) and hands them here, so the same flow serves
 * both of its doors.
 *
 * - `pane`: the editor's Make tool. The PNG enters the library AND is pinned
 *   onto the board at the pane's center, one undo step, as it always was.
 * - `library`: the sticker page's New sticker. The PNG enters the library in
 *   the picked folder and nothing is placed: a library action, so it pushes no
 *   board-history entry (see lib/stickerLibrary and DESIGN.md).
 */
export type StickerTarget
  = | { kind: 'pane', paneId: string }
    | { kind: 'library', folder: string }

/** The style inputs the dialog's controls resolve to. */
export interface StickerBakeStyle {
  outlineWidth: number
  outlineColor: string
  material: StickerMaterialType
  baseName: string
  perforation: PerforationDesign | null
  displayLongEdge: number
}

/** Long edge of the baked PNG (the library copy is the same asset either way). */
const INSERT_MAX = 960

/**
 * Rasterize the maker's inputs into a library asset: a PNG stamped
 * `kind: 'sticker'`, listed on the sticker page and never in the photo list.
 * Nothing is placed, so a caller that wants it on the board says so next.
 *
 * `original` is the picture the sticker was started from (see
 * lib/stickerRecipe): the original rides along on the asset, the baked PNG is
 * the asset itself, and together they let the maker reopen it. Without one the
 * sticker is still made, it just offers Erase and not Re-edit.
 */
export async function addStickerAsset(
  source: StickerSource,
  style: StickerBakeStyle,
  original?: StickerOriginalInput | null,
): Promise<Photo | null> {
  const res = await makeSticker(source, {
    outlineWidth: style.outlineWidth,
    outlineColor: style.outlineColor,
    perforation: style.perforation,
    displayLongEdge: style.displayLongEdge,
    maxEdge: INSERT_MAX,
    material: { type: style.material, intensity: 1 },
  })
  const file = await dataUrlToFile(res.dataUrl, `${style.baseName || 'sticker'}.png`)
  const photo = useStore.getState().addPhotos([file], false, 'sticker')[0] ?? null
  if (!photo || !original)
    return photo
  const recipe = await buildStickerRecipe(original, style)
  if (!recipe)
    return photo
  useStore.getState().setStickerRecipe(photo.id, recipe)
  return { ...photo, recipe }
}

/**
 * An erased copy of a sticker: the hand-painted PNG enters the library beside
 * the sticker it was painted over, in the same folder, and no board changes.
 * A new record is what keeps the snapshot principle intact: the copies already
 * placed draw the asset they were placed from, so the old pixels stay on every
 * board while the edited sticker is a fresh one in the library.
 *
 * It carries no recipe. Its pixels are hand work over a finished sticker, not
 * a fresh edit of an original, so a later Re-edit of it would silently drop the
 * strokes; Erase is its door.
 */
export async function eraseStickerAsset(
  photo: Photo,
  dataUrl: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<Photo | null> {
  const { folder, baseName } = editedStickerMeta(photo, 'erased')
  const file = await dataUrlToFile(dataUrl, `${baseName}.png`)
  const made = useStore.getState().addPhotos([file], false, 'sticker')[0] ?? null
  if (!made)
    return null
  const s = useStore.getState()
  if (folder)
    s.moveStickerToFolder(made.id, folder)
  say(t('Erased sticker saved to {folder}', { folder: folder || t('Unsorted') }))
  return { ...made, folder: folder || undefined }
}

/**
 * The maker's save: bake the sticker, then land it where the surface that
 * opened the maker asked for. Returns the asset, or null when the target is
 * gone (a closed pane) and nothing could be placed.
 */
export async function saveMadeSticker(
  source: StickerSource,
  style: StickerBakeStyle,
  target: StickerTarget,
  t: (key: string, vars?: Record<string, string | number>) => string,
  original?: StickerOriginalInput | null,
): Promise<Photo | null> {
  if (target.kind === 'pane' && !target.paneId)
    return null
  const photo = await addStickerAsset(source, style, original)
  if (!photo)
    return null
  const s = useStore.getState()
  if (target.kind === 'pane') {
    s.addSticker(photo.id, 0.5, 0.5)
    say(t('Sticker added'))
  }
  else {
    // Folder moves are library state (`stickerFolders`), so nothing commits.
    if (target.folder)
      s.moveStickerToFolder(photo.id, target.folder)
    say(t('Sticker saved to {folder}', { folder: target.folder || t('Unsorted') }))
  }
  return photo
}
