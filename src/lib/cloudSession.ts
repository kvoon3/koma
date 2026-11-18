import type { CloudProjectDetail, CloudProjectSummary } from './cloudApi'
import type { Node } from './panes'
import type { SessionMeta, SessionPhotoRecord, SessionSource } from './sessionStore'
import { parseSessionMeta, sessionMeta } from './sessionStore'

export type { CloudProjectDetail, CloudProjectSummary } from './cloudApi'

/** The document format this build writes. A reader refuses any other version. */
export const CLOUD_DOCUMENT_VERSION = 1

/**
 * What a saved cloud session holds: the board, its groups, the active ids and
 * the session settings. Pane leaves, board stickers, the cutout sets and the
 * background image all name their assets by id; no photo `File` is reachable
 * from this shape, so bytes never enter the row. It is deliberately separate
 * from the stored row: the row adds identity, ownership and timestamps, and a
 * version bump can change this payload alone.
 */
export interface CloudDocument {
  version: 1
  session: SessionMeta
}

export function serializeCloudDocument(session: SessionMeta): string {
  const document: CloudDocument = { version: CLOUD_DOCUMENT_VERSION, session }
  return JSON.stringify(document)
}

/** Parse an untrusted stored document; `null` means this build cannot read it. */
export function parseCloudDocument(value: unknown): CloudDocument | null {
  if (!isRecord(value) || value.version !== CLOUD_DOCUMENT_VERSION)
    return null
  const session = parseSessionMeta(value.session)
  return session ? { version: CLOUD_DOCUMENT_VERSION, session } : null
}

export function parseCloudDocumentText(text: string): CloudDocument | null {
  try {
    const raw: unknown = JSON.parse(text)
    return parseCloudDocument(raw)
  }
  catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseProjectSummary(value: unknown): CloudProjectSummary | null {
  if (!isRecord(value))
    return null
  const { id, name, createdAt, updatedAt } = value
  if (typeof id !== 'string' || typeof name !== 'string' || typeof createdAt !== 'string' || typeof updatedAt !== 'string')
    return null
  return { id, name, createdAt, updatedAt }
}

export function parseProjectSummaryList(value: unknown): CloudProjectSummary[] {
  if (!Array.isArray(value))
    return []
  return value.flatMap((entry) => {
    const summary = parseProjectSummary(entry)
    return summary ? [summary] : []
  })
}

export function parseProjectDetail(value: unknown): CloudProjectDetail | null {
  const summary = parseProjectSummary(value)
  if (!summary || !isRecord(value) || typeof value.userId !== 'string' || typeof value.document !== 'string')
    return null
  return { ...summary, userId: value.userId, document: value.document }
}

/** The store fields a save reads, plus the library it must upload first. */
export interface CloudSaveSource extends SessionSource {
  photos: SessionPhotoRecord[]
}

export interface CloudSavePlan {
  /** The library as it was when the save started; upload these pending ids. */
  photos: SessionPhotoRecord[]
  /** Built from that same read, so it cannot reference a later placement. */
  document: string
}

/**
 * One read for both halves of a save. A save takes time; if the document were
 * serialized after the uploads, a photo placed in between would be referenced
 * by the document but never uploaded, and a second device would draw an empty
 * pane. The later edit stays local until the next save.
 */
export function captureCloudSave(source: CloudSaveSource): CloudSavePlan {
  return { photos: source.photos, document: serializeCloudDocument(sessionMeta(source)) }
}

function collectNode(node: Node, ids: Set<string>): void {
  if (node.type === 'leaf') {
    if (node.photoId)
      ids.add(node.photoId)
    for (const sticker of node.stickers)
      ids.add(sticker.photoId)
    return
  }
  collectNode(node.a, ids)
  collectNode(node.b, ids)
}

/**
 * Every photo id the document can draw: panes, board stickers, both cutout
 * tables and the collage background. A second device downloads exactly these
 * assets, so another project's uploads do not fill this board's library.
 */
export function referencedPhotoIds(session: SessionMeta): string[] {
  const ids = new Set<string>()
  const addBoard = (workspace: SessionMeta['workspaces'][number]) => {
    collectNode(workspace.root, ids)
    for (const sticker of workspace.stickers ?? [])
      ids.add(sticker.photoId)
  }
  for (const workspace of session.workspaces)
    addBoard(workspace)
  for (const grid of session.grids ?? []) {
    for (const workspace of grid.workspaces)
      addBoard(workspace)
  }
  for (const [cutout, source] of Object.entries(session.cutouts ?? {})) {
    ids.add(cutout)
    ids.add(source)
  }
  for (const [source, set] of Object.entries(session.cutoutSets ?? {})) {
    ids.add(source)
    ids.add(set.cutout)
    if (set.blurred)
      ids.add(set.blurred)
  }
  if (session.bgImage)
    ids.add(session.bgImage.photoId)
  return [...ids]
}
