/**
 * The write bodies `routes/api/projects` accepts, parsed at the HTTP
 * boundary. Absent or wrong-kind fields read as a refusal, so the handlers
 * below never see a shape the database would store wrongly.
 */

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function trimmedName(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const name = value.trim()
  return name.length > 0 ? name : undefined
}

export function parseCreateBody(value: unknown): CreateProjectBody | null {
  if (!isRecord(value) || typeof value.document !== 'string')
    return null
  const name = trimmedName(value.name)
  return name === undefined ? null : { name, document: value.document }
}

export function parseUpdateBody(value: unknown): UpdateProjectBody | null {
  if (!isRecord(value) || typeof value.document !== 'string' || typeof value.updatedAt !== 'string')
    return null
  const name = trimmedName(value.name)
  return name === undefined
    ? { document: value.document, updatedAt: value.updatedAt }
    : { name, document: value.document, updatedAt: value.updatedAt }
}
