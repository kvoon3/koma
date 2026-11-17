/**
 * The cloud row this browser last loaded or saved, kept across reloads and
 * scoped to the signed-in email: sign out and in as someone else and the
 * identity is ignored rather than pointing a save at a row that is not that
 * user's. It is not the session itself; IndexedDB and the `document` column
 * own the boards.
 */
export interface CloudIdentity {
  email: string
  projectId: string
  updatedAt: string
}

const KEY = 'koma-cloud-project'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseIdentity(value: unknown): CloudIdentity | null {
  if (!isRecord(value))
    return null
  const { email, projectId, updatedAt } = value
  if (typeof email !== 'string' || typeof projectId !== 'string' || typeof updatedAt !== 'string')
    return null
  return { email, projectId, updatedAt }
}

export function loadCloudIdentity(email: string): CloudIdentity | null {
  if (typeof localStorage === 'undefined')
    return null
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === null)
      return null
    const raw: unknown = JSON.parse(stored)
    const identity = parseIdentity(raw)
    return identity?.email === email ? identity : null
  }
  catch {
    return null
  }
}

export function saveCloudIdentity(identity: CloudIdentity): void {
  if (typeof localStorage === 'undefined')
    return
  localStorage.setItem(KEY, JSON.stringify(identity))
}

export function clearCloudIdentity(): void {
  if (typeof localStorage === 'undefined')
    return
  localStorage.removeItem(KEY)
}
