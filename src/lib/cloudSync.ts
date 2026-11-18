import type { CloudAssetSummary } from './cloudApi'
import type { CloudProjectSummary } from './cloudSession'
import type { Translate } from './i18n'
import type { SessionMeta, SessionPhotoRecord } from './sessionStore'
import type { UploadFlowEvent } from './uploadFlow'
import { useCallback } from 'react'
import { useStore } from '../store'
import { ASSET_MAX_MB } from './assetKeys'
import { parseAssetSummaryList, photoRecordFromAsset, sessionPhotoMeta } from './cloudAsset'
import { clearCloudIdentity, loadCloudIdentity, saveCloudIdentity } from './cloudIdentity'
import { captureCloudSave, parseCloudDocumentText, parseProjectDetail, parseProjectSummary, parseProjectSummaryList, referencedPhotoIds } from './cloudSession'
import { loadSession } from './sessionStore'
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

interface UploadJob {
  file: File
  head: {
    id: string
    kind: 'photo' | 'sticker' | 'music'
    name: string
    trueW: number
    trueH: number
    meta: string | null
    type: string
  }
}

function photoJob(photo: SessionPhotoRecord): UploadJob {
  return {
    file: photo.file,
    head: {
      id: photo.id,
      kind: photo.kind ?? 'photo',
      name: photo.name,
      trueW: Math.round(photo.trueW),
      trueH: Math.round(photo.trueH),
      meta: JSON.stringify(sessionPhotoMeta(photo)),
      type: photo.file.type || ASSET_CONTENT_TYPE,
    },
  }
}

/**
 * The stills a save still has to send when the account lacks them. Live Photo
 * motion stays on this device only; cloud sync does not upload or restore it.
 * Retry converges on the same asset list.
 */
function pendingUploads(photos: SessionPhotoRecord[], known: ReadonlySet<string>): UploadJob[] {
  const jobs: UploadJob[] = []
  for (const photo of photos) {
    if (!known.has(photo.id))
      jobs.push(photoJob(photo))
  }
  return jobs
}

/** Send one file as head + newline + bytes; the server derives the key. */
async function uploadOne(job: UploadJob): Promise<void> {
  const body = new Blob([JSON.stringify(job.head), '\n', job.file])
  const response = await globalThis.fetch('/api/assets', {
    method: 'POST',
    body,
    headers: { 'content-type': ASSET_CONTENT_TYPE },
  })
  if (!response.ok)
    throw new AssetUploadError(response.status)
}

async function uploadPending(
  jobs: UploadJob[],
  t: Translate,
  send: (event: UploadFlowEvent) => boolean,
): Promise<void> {
  let done = 0
  send({ type: 'start', total: jobs.length })
  for (const job of jobs) {
    try {
      await uploadOne(job)
    }
    catch (error) {
      const message = error instanceof AssetUploadError && error.status === 413
        ? t('File too large. The limit is {mb} MB.', { mb: ASSET_MAX_MB })
        : t('Upload failed. Try again.')
      send({ type: 'failed', message })
      throw new UploadFailure(message)
    }
    done++
    send({ type: 'progress', done })
  }
  send({ type: 'finished', uploaded: jobs.length })
}

async function downloadFile(asset: CloudAssetSummary): Promise<File | null> {
  try {
    const response = await globalThis.fetch(`/api/assets/${encodeURIComponent(asset.id)}`)
    if (!response.ok)
      return null
    const blob = await response.blob()
    return new File([blob], asset.name, { type: blob.type || ASSET_CONTENT_TYPE })
  }
  catch {
    return null
  }
}

/**
 * The photo library a saved document draws on: what this device already has,
 * plus the assets the document references that it does not. Only referenced
 * ids download, so a second device gets this board's photos without this
 * account's other projects filling its library. A missing or broken asset
 * costs that photo, not the whole open. Live Photo motion is not restored.
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
      const file = await downloadFile(asset)
      if (!file)
        return
      const record = photoRecordFromAsset(asset, file)
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
      // One read for the upload list and the document: an edit made while the
      // uploads run stays local to the next save instead of being referenced
      // by a document that never uploaded its bytes.
      const plan = captureCloudSave(useStore.getState())
      const known = new Set(parseAssetSummaryList(await fetch('/api/assets', { headers: JSON_ACCEPT })).map(asset => asset.id))
      const jobs = pendingUploads(plan.photos, known)
      if (jobs.length > 0)
        await uploadPending(jobs, t, sendUpload)
      const document = plan.document
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
      // Open may have reset while this request flew; refuse to clobber its identity.
      if (!send({ type: 'saved', projectId: project.id, updatedAt: project.updatedAt }))
        return
      saveCloudIdentity({ email, projectId: project.id, updatedAt: project.updatedAt })
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
        void send({ type: 'conflict' })
        return
      }
      if (status === undefined)
        console.warn('[cloudSync] save:', error)
      if (!send({ type: 'failed', message: t('Cloud save failed. Try again.') }))
        return
      if (status === 404)
        clearCloudIdentity()
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
