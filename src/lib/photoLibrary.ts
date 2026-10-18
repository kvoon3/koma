/**
 * The photo-library plumbing the store's `addPhotos` / `clearLibrary` actions
 * call into: sorting and identifying a dropped batch (stills, HEIC, Live Photo
 * motion files), the header probe that fills in a photo's true dimensions, and
 * the wipe that blanks the boards once the library is gone. The batch helpers
 * are pure; the probes are the one thing here that touches a file.
 *
 * The zustand actions themselves stay in `store.ts` (they write state); this
 * module holds the logic they run, so the import rules can be reasoned about
 * without a store.
 */
import type { Workspace } from '../store'
import type { Dims, Photo } from './imageStore'
import type { ParkedBoard } from './workspaces'
import { looksHeic, probeHeic, warmHeicDecoder } from './heic'
import { probeJpeg, probePng } from './imageStore'
import { baseKey, splitLiveFiles } from './livephoto'

/** The two kinds of library asset: an imported photo, or a made sticker. */
export type PhotoKind = 'photo' | 'sticker'

/** Photo id → the photo, for the render passes that resolve a pane's `photoId`. */
export const photoMap = (photos: Photo[]) => new Map(photos.map(p => [p.id, p]))

/** One dropped batch, split into the stills to add and the motion files to glue on. */
export interface PhotoBatch {
  /** The new library entries, in name order (numeric-aware: IMG_2 before IMG_10). */
  added: Photo[]
  /** Live Photo videos by base name, waiting for a still of the same name. */
  videos: Map<string, File>
}

/**
 * Turn a dropped `File[]` into library entries. Stills are filtered to images
 * (or HEIC, which some browsers report as an empty / octet-stream type) and
 * sorted by their path in the drop, so a Finder folder import keeps its order;
 * motion files are keyed by base name for `glueMotionFiles`. Also starts the
 * (heavy, lazily imported) HEIC decoder when a HEIC is in the batch, so its
 * parse overlaps probing and rendering. `kind` stamps the batch: the sticker
 * maker's rendered PNGs enter as `'sticker'` assets, everything else as photos.
 */
export function importPhotoBatch(files: File[], kind: PhotoKind = 'photo'): PhotoBatch {
  const { images, videos } = splitLiveFiles(files)
  const vids = new Map<string, File>()
  for (const v of videos) {
    const k = baseKey(v.name)
    if (k && !vids.has(k))
      vids.set(k, v)
  }
  const imgs = images.filter(f => f.type.startsWith('image/') || looksHeic(f))
  if (imgs.some(looksHeic))
    warmHeicDecoder()
  imgs.sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, {
      numeric: true,
    }),
  )
  const stamp = Date.now().toString(36)
  const added: Photo[] = imgs.map((f, i) => ({
    id: `${stamp}-${i}-${Math.random().toString(36).slice(2, 7)}`,
    name: f.name,
    file: f,
    videoFile: vids.get(baseKey(f.name)),
    trueW: 0,
    trueH: 0,
    kind,
  }))
  return { added, videos: vids }
}

/**
 * A MOV dropped on its own glues onto an already-imported still with the same
 * basename (Finder / Photos exports arrive as HEIC + MOV pairs). The new
 * entries already carry their own motion file (see `importPhotoBatch`).
 */
export function glueMotionFiles(photos: Photo[], videos: Map<string, File>): Photo[] {
  return photos.map(p => (!p.videoFile && videos.get(baseKey(p.name))
    ? { ...p, videoFile: videos.get(baseKey(p.name)) }
    : p))
}

/**
 * A photo's pixel dimensions from its header: HEIC parses its own container,
 * JPEG reads the SOF, and a still that is neither (PNG today) falls back to
 * the PNG probe. Null when no probe could read it (a broken file).
 */
export async function probePhotoDims(file: File): Promise<Dims | null> {
  return (await (looksHeic(file) ? probeHeic(file) : probeJpeg(file))) ?? await probePng(file)
}

/** The library with one photo's true dimensions filled in. */
export function withPhotoDims(photos: Photo[], photoId: string, d: Dims): Photo[] {
  return photos.map(x => (x.id === photoId ? { ...x, trueW: d.w, trueH: d.h } : x))
}

/**
 * Every cell back to a fresh blank canvas, keeping each id and grid slot:
 * `activeId` and the store's `mapActive` key off those ids, so new ones would
 * leave every later pane action pointed at nothing.
 */
export function blankBoardCells(
  workspaces: Workspace[],
  fresh: () => Workspace,
): Workspace[] {
  return workspaces.map(w => ({ ...fresh(), id: w.id }))
}

/**
 * `clearLibrary`'s board wipe: the open group's cells and every parked group
 * (the photos are gone everywhere), each cell keeping its id and slot.
 */
export function blankAllBoards(
  workspaces: Workspace[],
  parkedBoards: Record<string, ParkedBoard<Workspace>>,
  fresh: () => Workspace,
): { workspaces: Workspace[], parkedBoards: Record<string, ParkedBoard<Workspace>> } {
  return {
    workspaces: blankBoardCells(workspaces, fresh),
    parkedBoards: Object.fromEntries(Object.entries(parkedBoards).map(([id, b]) => [
      id,
      { ...b, workspaces: blankBoardCells(b.workspaces, fresh) },
    ])),
  }
}
