/**
 * The chrome's view of the auth session, kept apart from `AuthScreen` so the
 * editor entry never pulls the better-auth client: the email comes from
 * `GET /api/me` (plain fetch), and the client loads lazily inside `signOut`,
 * sharing the auth chunk the screen already carries. The screen reports a
 * successful sign-in or sign-up through `notifyAuthChanged`, which refetches
 * here, so the chip follows without a reload.
 */
import { useEffect, useSyncExternalStore } from 'react'

export interface AuthEmail { email: string | null, pending: boolean }

let state: AuthEmail = { email: null, pending: true }
const listeners = new Set<() => void>()
let inFlight: Promise<void> | null = null

function publish(next: AuthEmail) {
  state = next
  listeners.forEach(l => l())
}

function parseMe(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && 'email' in data && typeof data.email === 'string')
    return data.email
  return null
}

function refetch(): Promise<void> {
  inFlight ??= (async () => {
    try {
      const res = await fetch('/api/me')
      const email = res.ok ? parseMe(await res.json()) : null
      publish({ email, pending: false })
    }
    catch {
      publish({ email: null, pending: false })
    }
    finally {
      inFlight = null
    }
  })()
  return inFlight
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** The signed-in user's email, or null; pending until the first /api/me answers. */
export function useAuthEmail(): AuthEmail {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    void refetch()
  }, [])
  return snapshot
}

/** The auth screen calls this after a sign-in or sign-up so the chip follows. */
export function notifyAuthChanged(): void {
  void refetch()
}

/** Sign out through the lazily loaded better-auth client, then update the chip. */
export async function signOut(): Promise<void> {
  const { auth } = await import('void/client/react')
  await auth.signOut()
  publish({ email: null, pending: false })
}
