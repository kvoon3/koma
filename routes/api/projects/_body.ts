/** The stored document's UTF-8 cap. The route answers 413 above it. */
export const DOCUMENT_MAX_BYTES = 1_000_000

/** The project name's character cap. The route answers 400 above it. */
export const NAME_MAX_CHARS = 200

export interface CreateProjectBody {
  name: string
  document: string
}

export interface UpdateProjectBody {
  name?: string
  document: string
  /** The `updatedAt` the client loaded; a mismatch is a stale write. */
  updatedAt: string
}

export type WriteBodyError = 'invalid' | 'invalid-name' | 'document-too-large'

export type ParsedWrite<T>
  = | { ok: true, value: T }
    | { ok: false, error: WriteBodyError }

export type JsonBody
  = | { ok: true, value: unknown }
    | { ok: false }

/** Malformed JSON is the caller's 400, not an unhandled 500. */
export function parseJsonBody(text: string): JsonBody {
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  }
  catch {
    return { ok: false }
  }
}

/** The status and body an invalid write answers; a large document is 413. */
export function writeBodyFailure(error: WriteBodyError): { status: 400 | 413, body: { error: string } } {
  return {
    status: error === 'document-too-large' ? 413 : 400,
    body: { error: error === 'invalid' ? 'invalid-body' : error },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readDocument(value: unknown): { document: string } | { error: WriteBodyError } {
  if (typeof value !== 'string')
    return { error: 'invalid' }
  if (new TextEncoder().encode(value).length > DOCUMENT_MAX_BYTES)
    return { error: 'document-too-large' }
  return { document: value }
}

/**
 * The optional name in both write bodies. Absent stays absent; present but
 * blank, too long or the wrong kind is an invalid name, never a silent drop.
 */
function readName(value: unknown): { name?: string } | { error: 'invalid-name' } {
  if (value === undefined)
    return {}
  if (typeof value !== 'string')
    return { error: 'invalid-name' }
  const name = value.trim()
  if (name.length === 0 || name.length > NAME_MAX_CHARS)
    return { error: 'invalid-name' }
  return { name }
}

export function parseCreateBody(value: unknown): ParsedWrite<CreateProjectBody> {
  if (!isRecord(value))
    return { ok: false, error: 'invalid' }
  const name = readName(value.name)
  if ('error' in name)
    return { ok: false, error: name.error }
  if (name.name === undefined)
    return { ok: false, error: 'invalid-name' }
  const document = readDocument(value.document)
  if ('error' in document)
    return { ok: false, error: document.error }
  return { ok: true, value: { name: name.name, document: document.document } }
}

export function parseUpdateBody(value: unknown): ParsedWrite<UpdateProjectBody> {
  if (!isRecord(value) || typeof value.updatedAt !== 'string')
    return { ok: false, error: 'invalid' }
  const name = readName(value.name)
  if ('error' in name)
    return { ok: false, error: name.error }
  const document = readDocument(value.document)
  if ('error' in document)
    return { ok: false, error: document.error }
  return {
    ok: true,
    value: name.name === undefined
      ? { document: document.document, updatedAt: value.updatedAt }
      : { name: name.name, document: document.document, updatedAt: value.updatedAt },
  }
}
