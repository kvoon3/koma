import type { Workspace } from '../store'
import type { CutoutMap } from './cutout'
import type { Photo } from './imageStore'
import type { Sticker } from './panes'
import { cleanEntryName, MAX_NAME_LEN, sameEntryName } from './assetNames'

/**
 * Sticker assets: the PNGs the sticker maker writes into the photo library,
 * kept apart from the photos by a marker on the asset itself
 * (`Photo.kind`) plus a one-level folder (`Photo.folder`, absent = Unsorted).
 *
 * Two states beyond that marker:
 * - `orphaned`: the asset was deleted from the library while a placed copy
 *   still draws it. The blob stays (rendering resolves stickers through the
 *   photos map, so dropping the record would blank the placed copy) and the
 *   asset is hidden from every list; it goes for good once nothing references
 *   it (see `retirePhoto` / `gcRetired`).
 * - nothing: a plain photo.
 *
 * Pure, so the fiddly parts (hydrate normalization, folder edits, usage
 * counting, the retire decision) are unit-tested without a store.
 *
 * Three of them are not sticker-specific and the photo manager uses them too:
 * `referenceCounts` (usage, derived from the boards), `retirePhoto` /
 * `gcRetired` (delete an asset, keep what still draws it) and the kind
 * normalization. Only the folder rules are stickers' own (`lib/photoTags`
 * holds the many-to-many counterpart).
 */

/** Folders are one level deep and named by hand; the cap keeps a chip readable. */
export const MAX_FOLDER_NAME = MAX_NAME_LEN

/** The assets the photo library lists: never a sticker, never a retired snapshot. */
export function photoAssetsOf(photos: readonly Photo[]): Photo[] {
  return photos.filter(p => p.kind !== 'sticker' && !p.orphaned)
}

/** The assets the sticker manager lists: makers' output only, retired ones hidden. */
export function stickerAssetsOf(photos: readonly Photo[]): Photo[] {
  return photos.filter(p => p.kind === 'sticker' && !p.orphaned)
}

/** A sticker's folder name; '' is Unsorted (the chip the page adds itself). */
export function folderOf(photo: Photo): string {
  return (photo.folder ?? '').trim()
}

/** Put a sticker in a folder ('' sends it back to Unsorted). */
export function withFolder(photo: Photo, folder: string): Photo {
  const name = folder.trim()
  return { ...photo, folder: name || undefined }
}

/** The named folders in use, one entry each, in display order. */
export function foldersInUse(stickers: readonly Photo[]): string[] {
  const seen = new Set<string>()
  for (const s of stickers) {
    const f = folderOf(s)
    if (f)
      seen.add(f)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Legacy sessions saved every photo without a kind, and every sticker of
 * theirs was just a PNG in the library: hydration stamps those as photos, so
 * the two lists are decided by the marker alone from then on.
 */
export function normalizePhotoKinds(photos: readonly Photo[]): Photo[] {
  return photos.map(p => (p.kind ? p : { ...p, kind: 'photo' as const }))
}

// ---- usage ---------------------------------------------------------------

function note(into: Map<string, number>, photoId: string | null | undefined) {
  if (photoId)
    into.set(photoId, (into.get(photoId) ?? 0) + 1)
}

function noteStickers(into: Map<string, number>, stickers: readonly Sticker[] | undefined) {
  for (const st of stickers ?? [])
    note(into, st.photoId)
}

/**
 * How many places one board draws each photo: the pane photos, the stickers
 * pinned onto those panes, and the board's own (canvas-level) stickers.
 */
export function boardRefs(workspace: Workspace, into: Map<string, number> = new Map()): Map<string, number> {
  const walk = (node: Workspace['root']): void => {
    if (node.type === 'leaf') {
      note(into, node.photoId)
      noteStickers(into, node.stickers)
      return
    }
    walk(node.a)
    walk(node.b)
  }
  walk(workspace.root)
  noteStickers(into, workspace.stickers)
  return into
}

/**
 * Photo id → how many places reference it, over every board passed in (all
 * groups, open and parked), plus any single ids (the collage background, the
 * pane clipboard). Labels carry icon ids, not photos, so they contribute
 * nothing.
 */
export function referenceCounts(
  boards: readonly Workspace[],
  singles: readonly (string | null | undefined)[] = [],
): Map<string, number> {
  const into = new Map<string, number>()
  for (const w of boards)
    boardRefs(w, into)
  for (const id of singles)
    note(into, id)
  return into
}

/** The places drawing one id (0 = unused). */
export function usesOf(counts: ReadonlyMap<string, number>, photoId: string): number {
  return counts.get(photoId) ?? 0
}

// ---- delete & garbage collection -----------------------------------------

/**
 * The library after a delete request for `photoId`: an asset something still
 * draws turns into an orphaned snapshot (kept, hidden, still rendering), and
 * one nothing draws leaves the library. Returns the list unchanged when the id
 * is unknown. Kind-agnostic on purpose: the sticker page and the photo page
 * delete through the same rule (see the store's `retireAsset`).
 */
export function retirePhoto(
  photos: Photo[],
  photoId: string,
  liveRefs: ReadonlySet<string>,
): Photo[] {
  if (!photos.some(p => p.id === photoId))
    return photos
  if (liveRefs.has(photoId))
    return photos.map(p => (p.id === photoId ? { ...p, orphaned: true } : p))
  return photos.filter(p => p.id !== photoId)
}

/**
 * Drop orphaned snapshots nothing draws any more. The session's own moment for
 * this is hydration: the history starts empty there, so no snapshot can bring
 * a reference back after the sweep.
 */
export function gcRetired(photos: readonly Photo[], liveRefs: ReadonlySet<string>): Photo[] {
  return photos.filter(p => !p.orphaned || liveRefs.has(p.id))
}

/** The cutout map without the entries a hydration dropped from the library. */
export function pruneCutouts(map: CutoutMap, liveIds: ReadonlySet<string>): CutoutMap {
  const next: CutoutMap = {}
  for (const [cutoutId, originalId] of Object.entries(map)) {
    if (liveIds.has(cutoutId) && liveIds.has(originalId))
      next[cutoutId] = originalId
  }
  return next
}

/** Every cutout entry that points at, or was cut from, a photo that is gone. */
export function dropCutoutRefs(map: CutoutMap, photoId: string): CutoutMap {
  const next: CutoutMap = {}
  for (const [cutoutId, originalId] of Object.entries(map)) {
    if (cutoutId === photoId || originalId === photoId)
      continue
    next[cutoutId] = originalId
  }
  return next
}

// ---- folder CRUD ---------------------------------------------------------

/** Why a folder edit was refused: nothing typed, a name already taken, a folder that is gone. */
export type FolderError = 'empty' | 'duplicate' | 'missing'

export type FolderEdit
  = | { ok: true, folders: string[], name: string }
    | { ok: false, reason: FolderError }

/** A folder name under the folder cap (see `lib/assetNames` for the shared rules). */
function cleanName(raw: string): string {
  return cleanEntryName(raw, MAX_FOLDER_NAME)
}

/** Add a folder to the list; the list keeps its order. */
export function addFolder(folders: readonly string[], raw: string): FolderEdit {
  const name = cleanName(raw)
  if (!name)
    return { ok: false, reason: 'empty' }
  if (folders.some(f => sameEntryName(f, name)))
    return { ok: false, reason: 'duplicate' }
  return { ok: true, folders: [...folders, name], name }
}

/**
 * Rename one folder. Renaming it to itself (or to the same name in another
 * case) succeeds without moving anything; an unknown folder is refused.
 */
export function renameFolder(folders: readonly string[], from: string, raw: string): FolderEdit {
  if (!folders.includes(from))
    return { ok: false, reason: 'missing' }
  const name = cleanName(raw)
  if (!name)
    return { ok: false, reason: 'empty' }
  if (folders.some(f => f !== from && sameEntryName(f, name)))
    return { ok: false, reason: 'duplicate' }
  return { ok: true, folders: folders.map(f => (f === from ? name : f)), name }
}

/** Delete a folder from the list (its stickers are the caller's to move). */
export function deleteFolder(folders: readonly string[], name: string): string[] {
  return folders.includes(name) ? folders.filter(f => f !== name) : [...folders]
}
