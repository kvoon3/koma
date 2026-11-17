import { assets } from '@schema'
import { defineHandler } from 'void'
import { requireAuth } from 'void/auth'
import { and, db, desc, eq } from 'void/db'
import { storage } from 'void/storage'
import { assetStorageKey } from '../../../src/lib/assetKeys'
import { AssetTooLargeError, readUploadBody } from './_upload'

/**
 * The summary the browser gets from the list and the upload. `storage_path`
 * stays on the server: the key is the server's to derive, never the client's
 * to learn or name (see `lib/assetKeys`).
 */
const SUMMARY = {
  id: assets.id,
  kind: assets.kind,
  name: assets.name,
  trueW: assets.trueW,
  trueH: assets.trueH,
  meta: assets.meta,
  createdAt: assets.createdAt,
}

function declaredLength(raw: string | undefined): number | null {
  if (raw === undefined)
    return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** This user's assets, newest first: what a second device uses to resolve a saved document's ids. */
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c)
  return await db
    .select(SUMMARY)
    .from(assets)
    .where(eq(assets.userId, user.id))
    .orderBy(desc(assets.createdAt))
})

/**
 * Upload one asset: JSON head, newline, bytes (see `_upload.ts`). The row and
 * the R2 object are written here together, and the id is the client's photo id
 * so references already in the cloud document keep pointing at it.
 *
 * The 50 MB cap is safe under the worker memory limit because the bytes never
 * gather in memory: the head is capped at 2 MB and the file streams chunk by
 * chunk into `storage.put`. The cap bounds request cost and R2 object size,
 * not this isolate's heap.
 *
 * A retry converges: the same id overwrites the same key and updates the same
 * row. An id another account already owns answers 409 without touching that
 * row or object, because the key is built from the caller's user id. If the
 * row write fails after the object write, a new object is deleted again.
 */
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c)
  const read = await readUploadBody(c.req.raw.body, declaredLength(c.req.header('content-length')))
  if (!read.ok)
    return c.json({ error: read.error }, read.status)

  const key = assetStorageKey(user.id, read.head.id)
  if (!key) {
    await read.body.cancel().catch(() => {})
    return c.json({ error: 'invalid-id' }, 400)
  }

  const [owner] = await db
    .select({ userId: assets.userId })
    .from(assets)
    .where(eq(assets.id, read.head.id))
    .limit(1)
  if (owner && owner.userId !== user.id) {
    await read.body.cancel().catch(() => {})
    return c.json({ error: 'asset-id-taken' }, 409)
  }
  // A failed first insert leaves an orphan object; a failed update must not
  // delete the object its existing row already points at.
  const hadRow = owner !== undefined

  const fields = {
    kind: read.head.kind,
    storagePath: key,
    name: read.head.name,
    trueW: read.head.trueW,
    trueH: read.head.trueH,
    meta: read.head.meta,
  }

  let stored = false
  try {
    // R2 refuses a stream without a known length; the FixedLengthStream is what
    // carries the declared size, so the bytes still stream instead of buffering.
    const fixed = new FixedLengthStream(read.size)
    await Promise.all([
      storage.put(key, fixed.readable, { httpMetadata: { contentType: read.head.contentType } }),
      read.body.pipeTo(fixed.writable),
    ])
    stored = true
    const [inserted] = await db
      .insert(assets)
      .values({ id: read.head.id, userId: user.id, ...fields })
      .onConflictDoNothing({ target: assets.id })
      .returning(SUMMARY)
    if (inserted)
      return inserted
    const [updated] = await db
      .update(assets)
      .set(fields)
      .where(and(eq(assets.id, read.head.id), eq(assets.userId, user.id)))
      .returning(SUMMARY)
    if (updated)
      return updated
    await storage.delete(key).catch(() => {})
    return c.json({ error: 'asset-id-taken' }, 409)
  }
  catch (error) {
    if (stored && !hadRow)
      await storage.delete(key).catch(() => {})
    if (error instanceof AssetTooLargeError)
      return c.json({ error: 'too-large' }, 413)
    throw error
  }
})
