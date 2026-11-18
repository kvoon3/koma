import { assets } from '@schema'
import { defineHandler } from 'void'
import { requireAuth } from 'void/auth'
import { and, db, eq } from 'void/db'
import { storage } from 'void/storage'
import { assetStorageKey, isAssetId } from '../../../src/lib/assetKeys'
import { serveAsset } from './_serve'

/** This user's asset, or a 404. An id another account owns answers the same 404. */
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c)
  const id = c.req.param('id')
  if (!id || !isAssetId(id))
    return c.json({ error: 'invalid-id' }, 400)
  const [asset] = await db
    .select({ storagePath: assets.storagePath })
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.userId, user.id)))
    .limit(1)
  if (!asset)
    return c.json({ error: 'not-found' }, 404)
  const object = await storage.get(asset.storagePath)
  if (!object)
    return c.json({ error: 'not-found' }, 404)
  return serveAsset(object)
})

/**
 * Remove the row and the object. Safe to retry: both deletes converge, so a
 * crash between them leaves the next call with the object to remove, and a
 * second call with nothing left to do. The key is derived from the caller's
 * user id, so another account's id can only ever address the caller's own
 * (empty) prefix.
 */
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c)
  const id = c.req.param('id')
  if (!id || !isAssetId(id))
    return c.json({ error: 'invalid-id' }, 400)
  const [removed] = await db
    .delete(assets)
    .where(and(eq(assets.id, id), eq(assets.userId, user.id)))
    .returning({ storagePath: assets.storagePath })
  const key = assetStorageKey(user.id, id)
  if (removed)
    await storage.delete(removed.storagePath)
  // The derived key is canonical; a second delete is a no-op when the row's
  // path was the same and converges when a retry finds only the object.
  if (key && key !== removed?.storagePath)
    await storage.delete(key)
  return { id }
})
