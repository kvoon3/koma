import { defineHandler } from 'void'
import { requireAuth } from 'void/auth'

/**
 * The signed-in user's email, or 401 when the request carries no session.
 * PR-2's cloud save route and the chrome's signed-in probes consume it;
 * nothing else uses it yet.
 */
export const GET = defineHandler((c) => {
  const user = requireAuth(c)
  return { email: user.email }
})
