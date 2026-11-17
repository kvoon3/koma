import type { CloudProjectSummary } from './cloudSession'
import type { Translate } from './i18n'
import { useCallback } from 'react'
import { useStore } from '../store'
import { clearCloudIdentity, loadCloudIdentity, saveCloudIdentity } from './cloudIdentity'
import { parseCloudDocumentText, parseProjectDetail, parseProjectSummary, parseProjectSummaryList, serializeCloudDocument } from './cloudSession'
import { loadSession, sessionMeta } from './sessionStore'
import { SYNC_IDLE, syncTransition } from './syncFlow'
import { say } from './toast'
import { useFlow } from './useFlow'

/** Load void's route fetch once, on the first cloud action; it stays out of the editor entry. */
let clientModule: Promise<typeof import('void/client')> | null = null
function client() {
  clientModule ??= import('void/client')
  return clientModule
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
 *
 * Requests use the typed `fetch` from `void/client`; `src/cloudRoutes.d.ts`
 * declares the two routes to the browser program, which cannot take void's
 * generated map (it imports handler types, and those pull Cloudflare's worker
 * globals over the DOM). The response parsers in lib/cloudSession are the
 * runtime boundary either way, so the payload is never trusted blindly.
 */
export function useCloudSync({ email, t }: { email: string | null, t: Translate }) {
  const { state, send } = useFlow(SYNC_IDLE, syncTransition)

  const save = useCallback(async () => {
    if (!email || !send({ type: 'save' }))
      return
    try {
      const { fetch } = await client()
      const document = serializeCloudDocument(sessionMeta(useStore.getState()))
      const identity = loadCloudIdentity(email)
      let saved: CloudProjectSummary | null
      if (identity) {
        saved = parseProjectSummary(await fetch('/api/projects/:id', {
          method: 'PUT',
          params: { id: identity.projectId },
          body: { document, updatedAt: identity.updatedAt },
        }))
      }
      else {
        saved = parseProjectSummary(await fetch('/api/projects', {
          method: 'POST',
          body: { name: projectName(), document },
        }))
      }
      if (!saved)
        throw new Error('unexpected cloud response')
      const project = { id: saved.id, updatedAt: saved.updatedAt }
      useStore.getState().setCloudProject(project)
      saveCloudIdentity({ email, projectId: project.id, updatedAt: project.updatedAt })
      send({ type: 'saved', projectId: project.id, updatedAt: project.updatedAt })
      say(t('Saved to cloud'))
    }
    catch (error) {
      const { FetchError } = await client()
      if (error instanceof FetchError && error.status === 409) {
        send({ type: 'conflict' })
        return
      }
      if (error instanceof FetchError && error.status === 404)
        clearCloudIdentity()
      send({ type: 'failed', message: t('Cloud save failed. Try again.') })
      say(t('Cloud save failed. Try again.'))
    }
  }, [email, send, t])

  const listProjects = useCallback(async (): Promise<CloudProjectSummary[]> => {
    const { fetch } = await client()
    return parseProjectSummaryList(await fetch('/api/projects'))
  }, [])

  /**
   * Replace the open board with a cloud copy. Local photos are kept in the
   * library: on the device that saved the row their ids match and the panes
   * draw immediately, while a second device has none and waits for the asset
   * upload PR. The document carries no bytes either way.
   */
  const openProject = useCallback(async (id: string): Promise<boolean> => {
    if (!email)
      return false
    try {
      const { fetch } = await client()
      const project = parseProjectDetail(await fetch('/api/projects/:id', { params: { id } }))
      const document = project ? parseCloudDocumentText(project.document) : null
      if (!project || !document) {
        say(t('Could not open the cloud session.'))
        return false
      }
      const local = await loadSession()
      useStore.getState().hydrate({ meta: document.session, photos: local?.photos ?? [] })
      const saved = { id: project.id, updatedAt: project.updatedAt }
      useStore.getState().setCloudProject(saved)
      saveCloudIdentity({ email, projectId: saved.id, updatedAt: saved.updatedAt })
      send({ type: 'reset' })
      say(t('Loaded from cloud'))
      return true
    }
    catch {
      say(t('Could not open the cloud session.'))
      return false
    }
  }, [email, send, t])

  return { state, save, listProjects, openProject, dismiss: () => send({ type: 'dismissed' }) }
}
