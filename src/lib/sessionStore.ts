import type { Workspace } from '../store'
import type { BgImage } from './collageBg'
import type { CutoutMap } from './cutout'
import type { StickerRecipe } from './stickerRecipe'

export interface SessionPhotoRecord {
  id: string
  name: string
  trueW: number
  trueH: number
  file: File
  videoFile?: File
  /** Absent in sessions saved before stickers were an asset of their own. */
  kind?: 'photo' | 'sticker'
  /** Sticker folder; absent = Unsorted. */
  folder?: string
  /** Manual tags (see lib/photoTags); absent in sessions saved before tagging. */
  tags?: string[]
  /** Deleted asset a placed copy still draws (see lib/stickerLibrary). */
  orphaned?: boolean
  /**
   * How a made sticker was drawn, so it reopens in the maker (see
   * lib/stickerRecipe). Absent on every sticker made before re-editing, and on
   * every photo: such an asset offers Erase only.
   */
  recipe?: StickerRecipe
  /** WGS-84 camera fix and EXIF capture time, so the EXIF block survives a reload. */
  gps?: { lat: number, lng: number }
  takenAt?: string
}

/** One board of nine, saved with the session (see `normalizeGrids`). */
export interface SessionGrid {
  id: string
  name: string
  workspaces: Workspace[]
  /** The cell last edited in this group (where it re-opens). */
  activeId: string
}

export interface SessionMeta {
  /** The board groups, in bar order; absent in sessions saved before dual grid. */
  grids?: SessionGrid[]
  /** The group that was open. */
  activeGridId?: string
  /**
   * The open group's cells, written beside `grids` so a build from before the
   * dual grid still reads the board it saved (and so a session that has no
   * `grids` at all, from that build, still loads here: see `normalizeGrids`).
   */
  workspaces: Workspace[]
  activeId: string
  gap: number
  radius: number
  bg: string
  /** Cutout → original photo ids; absent in sessions saved before one-tap cutout. */
  cutouts?: CutoutMap
  /** Absent in sessions saved before the sticker manager: no named folders yet. */
  stickerFolders?: string[]
  /** Absent in sessions saved before photo tagging: no tags yet. */
  photoTags?: string[]
  /** Absent in sessions saved before the collage background (see migrateSettings v8). */
  bgGradient?: string | null
  bgImage?: BgImage | null
  longSide: number
  format: 'image/jpeg' | 'image/png'
  quality: number
}

/** The store slices a session is built from (see `sessionMeta`). */
export interface SessionSource {
  grids: { id: string, name: string }[]
  activeGridId: string
  workspaces: Workspace[]
  activeId: string
  /** Boards of the groups that are not open, by group id. */
  parkedBoards: Record<string, { workspaces: Workspace[], activeId: string }>
  /** The named sticker folders (empty folders persist too). */
  stickerFolders: string[]
  /** The named photo tags (empty tags persist too). */
  photoTags: string[]
  gap: number
  radius: number
  bg: string
  cutouts: CutoutMap
  bgGradient: string | null
  bgImage: BgImage | null
  longSide: number
  format: 'image/jpeg' | 'image/png'
  quality: number
}

/**
 * The session payload for the store's state: one entry per group, each with its
 * board (the open group's is `workspaces`) and the cell it was last on.
 */
export function sessionMeta(s: SessionSource): SessionMeta {
  return {
    grids: s.grids.map(g => ({
      id: g.id,
      name: g.name,
      workspaces: g.id === s.activeGridId ? s.workspaces : s.parkedBoards[g.id]?.workspaces ?? [],
      activeId: g.id === s.activeGridId ? s.activeId : s.parkedBoards[g.id]?.activeId ?? '',
    })),
    activeGridId: s.activeGridId,
    workspaces: s.workspaces,
    activeId: s.activeId,
    stickerFolders: s.stickerFolders,
    photoTags: s.photoTags,
    gap: s.gap,
    radius: s.radius,
    bg: s.bg,
    cutouts: s.cutouts,
    bgGradient: s.bgGradient,
    bgImage: s.bgImage,
    longSide: s.longSide,
    format: s.format,
    quality: s.quality,
  }
}

const DB_NAME = 'koma-session'
const DB_VERSION = 1
const META_KEY = 'session'

let dbPromise: Promise<IDBDatabase> | null = null
/**
 * The ids written in this page session, with the signature of the record's
 * mutable fields (name, dims, kind, folder, orphaned, and whether it carries a
 * maker's recipe): a File is immutable so an unchanged record is never re-put,
 * while a sticker moving between folders is (the record itself is all that is
 * written again, the File riding along as a reference rather than as fresh
 * bytes). The recipe's own bytes stay out of the signature: it is written once
 * with the asset and never edited, so its presence is all that can change.
 * mutable fields (name, dims, kind, folder, orphaned, tags, gps, takenAt): a
 * File is immutable so an unchanged record is never re-put, while a sticker
 * moving between folders or a photo gaining a tag is (the record itself is all
 * that is written again, the File riding along as a reference rather than as
 * fresh bytes).
 */
const writtenIds = new Map<string, string>()

/** Everything about a record except its pixels (and the recipe's payload). */
function recordSignature(p: SessionPhotoRecord): string {
  return JSON.stringify([p.name, p.trueW, p.trueH, p.kind ?? '', p.folder ?? '', p.orphaned ?? false, p.recipe ? 1 : 0])
  return JSON.stringify([p.name, p.trueW, p.trueH, p.kind ?? '', p.folder ?? '', p.orphaned ?? false, p.tags ?? [], p.gps ?? null, p.takenAt ?? ''])
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise)
    return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('photos'))
        db.createObjectStore('photos', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('indexedDB open blocked'))
  })
  // Don't retry forever: cache the rejection so callers see null/no-op.
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function warn(label: string, err: unknown) {
  console.warn(`[sessionStore] ${label}:`, err)
}

export async function saveSession(meta: SessionMeta, photos: SessionPhotoRecord[]): Promise<void> {
  let db: IDBDatabase
  try {
    db = await openDB()
  }
  catch (err) {
    warn('open', err)
    return
  }

  try {
    const tx = db.transaction(['meta', 'photos'], 'readwrite')
    void tx.objectStore('meta').put(meta, META_KEY)
    const photoOs = tx.objectStore('photos')
    for (const p of photos) {
      const signature = recordSignature(p)
      if (writtenIds.get(p.id) === signature)
        continue
      photoOs.put(p)
      writtenIds.set(p.id, signature)
    }
    await txDone(tx)
  }
  catch (err) {
    warn('save', err)
  }
}

export async function loadSession(): Promise<{ meta: SessionMeta, photos: SessionPhotoRecord[] } | null> {
  let db: IDBDatabase
  try {
    db = await openDB()
  }
  catch (err) {
    warn('open', err)
    return null
  }

  try {
    const tx = db.transaction(['meta', 'photos'], 'readonly')
    const meta = await reqToPromise(tx.objectStore('meta').get(META_KEY))
    const photos = (await reqToPromise(tx.objectStore('photos').getAll())) as SessionPhotoRecord[]
    if (!meta || !Array.isArray(photos)) {
      // Mark anything we already wrote in this session so saveSession skips it.
      for (const p of photos)
        writtenIds.set(p.id, recordSignature(p))
      return null
    }
    for (const p of photos)
      writtenIds.set(p.id, recordSignature(p))
    return { meta: meta as SessionMeta, photos }
  }
  catch (err) {
    warn('load', err)
    return null
  }
}

export async function clearSession(): Promise<void> {
  writtenIds.clear()
  let db: IDBDatabase
  try {
    db = await openDB()
  }
  catch (err) {
    warn('open', err)
    return
  }

  try {
    const tx = db.transaction(['meta', 'photos'], 'readwrite')
    tx.objectStore('meta').delete(META_KEY)
    tx.objectStore('photos').clear()
    await txDone(tx)
  }
  catch (err) {
    warn('clear', err)
  }
}

// # ponytail: photos are re-saved whole-file. If workspaces ever reference
// hundreds of photos, switch to incremental deletes of removed ids (upgrade
// path: bump DB_VERSION, add a deletedIds set, prune on save).
