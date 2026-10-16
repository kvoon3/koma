import type { Workspace } from '../store'
import type { BgImage } from './collageBg'

export interface SessionPhotoRecord {
  id: string
  name: string
  trueW: number
  trueH: number
  file: File
  videoFile?: File
}

export interface SessionMeta {
  workspaces: Workspace[]
  activeId: string
  gap: number
  radius: number
  bg: string
  /** Absent in sessions saved before the collage background (see migrateSettings v2). */
  bgGradient?: string | null
  bgImage?: BgImage | null
  longSide: number
  format: 'image/jpeg' | 'image/png'
  quality: number
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
