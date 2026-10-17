import type { Workspace } from '../store'
import type { BgImage } from './collageBg'
import type { CutoutMap } from './cutout'

export interface SessionPhotoRecord {
  id: string
  name: string
  trueW: number
  trueH: number
  file: File
  videoFile?: File
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
/** Ids already written in this page session; Files are immutable so no re-put. */
const writtenIds = new Set<string>()

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
      if (writtenIds.has(p.id))
        continue
      // Files are immutable across re-renders, so once written we never re-put.
      photoOs.put(p)
      writtenIds.add(p.id)
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
        writtenIds.add(p.id)
      return null
    }
    for (const p of photos)
      writtenIds.add(p.id)
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
