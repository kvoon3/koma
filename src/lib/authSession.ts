/**
 * The chrome's view of the auth session, kept apart from `AuthScreen` so the
 * editor entry imports this module (a few hundred bytes) while the screen's
 * chunk stays behind its lazy route.
 *
 * `void/client/react`'s `auth` client is the only source of session truth.
 * `useSession` revalidates from `/api/auth/get-session` on mount, so a reload
 * picks the cookie's session back up and a sign-out anywhere refetches here.
 */
import { auth } from 'void/client/react'

export { auth }

/** The signed-in user's email, or null. Pending resolves to null with a flag. */
export function useAuthEmail(): { email: string | null, pending: boolean } {
  const session = auth.useSession()
  return { email: session.data?.user?.email ?? null, pending: session.isPending }
}
