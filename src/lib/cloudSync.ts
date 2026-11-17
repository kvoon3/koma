import type { CloudAssetSummary } from './cloudApi'
import type { CloudProjectSummary } from './cloudSession'
import type { Translate } from './i18n'
import type { SessionMeta, SessionPhotoRecord } from './sessionStore'
import type { UploadFlowEvent } from './uploadFlow'
import { useCallback } from 'react'
import { useStore } from '../store'
import { isAssetId } from './assetKeys'
import { parseAssetSummaryList, photoRecordFromAsset, sessionPhotoMeta } from './cloudAsset'
import { clearCloudIdentity, loadCloudIdentity, saveCloudIdentity } from './cloudIdentity'
import { parseCloudDocumentText, parseProjectDetail, parseProjectSummary, parseProjectSummaryList, referencedPhotoIds, serializeCloudDocument } from './cloudSession'
import { loadSession, sessionMeta } from './sessionStore'
import { SYNC_IDLE, syncTransition } from './syncFlow'
import { say } from './toast'
import { UPLOAD_IDLE, uploadTransition } from './uploadFlow'
import { useFlow } from './useFlow'

/** Load void's route fetch once, on the first cloud action; it stays out of the editor entry. */
let clientModule: Promise<typeof import('void/client')> | null = null
function client() {
  clientModule ??= import('void/client').catch((error: unknown) => {
    // A failed chunk load (offline, a redeploy) must not poison every retry.
    clientModule = null
    throw error instanceof Error ? error : new Error('cloud client failed to load')
  })
  return clientModule
}

/** Every cloud call names JSON, so the dev server's HTML fallback never answers a missing id. */
const JSON_ACCEPT = { Accept: 'application/json' }

/** The server's per-file cap, shown in the too-large error. Keep in step with `routes/api/assets/_upload.ts`. */
const ASSET_LIMIT_MB = 50

/** The request body is raw bytes; the file's real type travels inside the head. */
const ASSET_CONTENT_TYPE = 'application/octet-stream'

/** A browser can open many sockets, but a library is not worth all of them at once. */
const DOWNLOAD_BATCH = 4

/** An upload the server refused, carrying the status the caller translates. */
class AssetUploadError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`asset upload failed: ${status}`)
    this.name = 'AssetUploadError'
    this.status = status
  }
}

/** Carries the user-facing upload message to the save's one catch. */
class UploadFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadFailure'
  }
}

/**
 * Send one photo as head + newline + bytes. The id is the client photo id, so
 * the document's references keep resolving; the server validates it, derives
 * the storage key, and scopes both to the caller.
 */
async function uploadOne(photo: SessionPhotoRecord): Promise<void> {
  if (!isAssetId(photo.id))
    throw new AssetUploadError(400)
  const head = {
    id: photo.id,
    kind: photo.kind ?? 'photo',
    name: photo.name,
    trueW: Math.round(photo.trueW),
    trueH: Math.round(photo.trueH),
    meta: JSON.stringify(sessionPhotoMeta(photo)),
    type: photo.file.type || ASSET_CONTENT_TYPE,
  }
  const body = new Blob([JSON.stringify(head), '\n', photo.file])
  const response = await globalThis.fetch('/api/assets', {
    method: 'POST',
    body,
    headers: { 'content-type': ASSET_CONTENT_TYPE },
  })
  if (!response.ok)
    throw new AssetUploadError(response.status)
}

async function uploadPending(
  photos: SessionPhotoRecord[],
  t: Translate,
  send: (event: UploadFlowEvent) => boolean,
): Promise<void> {
  let done = 0
  send({ type: 'start', total: photos.length })
  for (const photo of photos) {
    try {
      await uploadOne(photo)
    }
    catch (error) {
      const message = error instanceof AssetUploadError && error.status === 413
        ? t('Photo too large. The limit is {mb} MB.', { mb: ASSET_LIMIT_MB })
        : t('Upload failed. Try again.')
      send({ type: 'failed', message })
      throw new UploadFailure(message)
    }
    done++
    send({ type: 'progress', done })
  }
  send({ type: 'finished', uploaded: photos.length })
}

async function downloadOne(asset: CloudAssetSummary): Promise<SessionPhotoRecord | null> {
  const response = await globalThis.fetch(`/api/assets/${encodeURIComponent(asset.id)}`)
  if (!response.ok)
    return null
  const blob = await response.blob()
  return photoRecordFromAsset(asset, new File([blob], asset.name, { type: blob.type || ASSET_CONTENT_TYPE }))
}

/**
 * The photo library a saved document draws on: what this device already has,
 * plus the assets the document references that it does not. Only referenced
 * ids download, so a second device gets this board's photos without this
 * account's other projects filling its library. A missing or broken asset
 * costs that photo, not the whole open.
 */
async function resolvePhotos(session: SessionMeta, localPhotos: SessionPhotoRecord[]): Promise<SessionPhotoRecord[]> {
  const merged = new Map(localPhotos.map(photo => [photo.id, photo]))
  const missing = referencedPhotoIds(session).filter(id => !merged.has(id))
  if (missing.length === 0)
    return [...merged.values()]

  let assets
  try {
    const { fetch } = await client()
    assets = parseAssetSummaryList(await fetch('/api/assets', { headers: JSON_ACCEPT }))
  }
  catch {
    return [...merged.values()]
  }

  const byId = new Map(assets.map(asset => [asset.id, asset]))
  for (let start = 0; start < missing.length; start += DOWNLOAD_BATCH) {
    const batch = missing.slice(start, start + DOWNLOAD_BATCH)
    await Promise.all(batch.map(async (id) => {
      const asset = byId.get(id)
      if (!asset)
        return
      const record = await downloadOne(asset)
      if (record)
        merged.set(id, record)
    }))
  }
  return [...merged.values()]
}

/** The HTTP status an ofetch error carries, without importing its class. */
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error))
    return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

/** A saved session's default name: data, not interface copy, so no translation key. */
function projectName(now = new Date()): string {
  return `Session ${now.toISOString().slice(0, 16).replace('T', ' ')}`
}

/**
 * The explicit Save to cloud action and the cloud open path. No effect ever
 * saves: the user clicks, one request runs, and the flow (see lib/syncFlow)
 * owns what the account menu shows. A reload keeps the row identity per
 * email (lib/cloudIdentity), so the next save overwrites instead of adding a
 * second row.
 */
export function useCloudSync({ email, t }: { email: string | null, t: Translate }) {
  const { state, send } = useFlow(SYNC_IDLE, syncTransition)
  const { state: uploadState, send: sendUpload } = useFlow(UPLOAD_IDLE, uploadTransition)

  const save = useCallback(async () => {
    if (!email || !send({ type: 'save' }))
      return
    try {
      const { fetch } = await client()
      const photos = useStore.getState().photos
      const known = new Set(parseAssetSummaryList(await fetch('/api/assets', { headers: JSON_ACCEPT })).map(asset => asset.id))
      const pending = photos.filter(photo => !known.has(photo.id))
      if (pending.length > 0)
        await uploadPending(pending, t, sendUpload)
      const document = serializeCloudDocument(sessionMeta(useStore.getState()))
      const identity = loadCloudIdentity(email)
      let saved: CloudProjectSummary | null
      if (identity) {
        saved = parseProjectSummary(await fetch('/api/projects/:id', {
          method: 'PUT',
          params: { id: identity.projectId },
          body: { document, updatedAt: identity.updatedAt },
          headers: JSON_ACCEPT,
        }))
      }
      else {
        saved = parseProjectSummary(await fetch('/api/projects', {
          method: 'POST',
          body: { name: projectName(), document },
          headers: JSON_ACCEPT,
        }))
      }
      if (!saved)
        throw new Error('unexpected cloud response')
      const project = { id: saved.id, updatedAt: saved.updatedAt }
      saveCloudIdentity({ email, projectId: project.id, updatedAt: project.updatedAt })
      send({ type: 'saved', projectId: project.id, updatedAt: project.updatedAt })
      say(t('Saved to cloud'))
    }
    catch (error) {
      if (error instanceof UploadFailure) {
        send({ type: 'failed', message: error.message })
        say(error.message)
        return
      }
      const status = httpStatus(error)
      if (status === 409) {
        send({ type: 'conflict' })
        return
      }
      if (status === 404)
        clearCloudIdentity()
      if (status === undefined)
        console.warn('[cloudSync] save:', error)
      send({ type: 'failed', message: t('Cloud save failed. Try again.') })
      say(t('Cloud save failed. Try again.'))
    }
  }, [email, send, sendUpload, t])

  const listProjects = useCallback(async (): Promise<CloudProjectSummary[]> => {
    const { fetch } = await client()
    return parseProjectSummaryList(await fetch('/api/projects', { headers: JSON_ACCEPT }))
  }, [])

  const openProject = useCallback(async (id: string): Promise<boolean> => {
    if (!email)
      return false
    try {
      const { fetch } = await client()
      const project = parseProjectDetail(await fetch('/api/projects/:id', { params: { id }, headers: JSON_ACCEPT }))
      const document = project ? parseCloudDocumentText(project.document) : null
      if (!project || !document) {
        say(t('Could not open the cloud session.'))
        return false
      }
      const local = await loadSession()
      const photos = await resolvePhotos(document.session, local?.photos ?? [])
      useStore.getState().hydrate({ meta: document.session, photos })
      const saved = { id: project.id, updatedAt: project.updatedAt }
      saveCloudIdentity({ email, projectId: saved.id, updatedAt: saved.updatedAt })
      send({ type: 'reset' })
      say(t('Loaded from cloud'))
      return true
    }
    catch (error) {
      if (httpStatus(error) === undefined)
        console.warn('[cloudSync] open:', error)
      say(t('Could not open the cloud session.'))
      return false
    }
  }, [email, send, t])

  const dismiss = useCallback(() => {
    send({ type: 'dismissed' })
    sendUpload({ type: 'dismissed' })
  }, [send, sendUpload])

  return { state, uploadState, save, listProjects, openProject, dismiss }
}
