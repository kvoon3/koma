import type { CloudProjectDetail, CloudProjectSummary } from './cloudApi'
import type { SessionMeta } from './sessionStore'
import { parseSessionMeta } from './sessionStore'

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
