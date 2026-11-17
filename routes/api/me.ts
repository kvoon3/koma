import { defineHandler } from 'void'
import { requireAuth } from 'void/auth'

/** The signed-in user's email, or 401 when the request carries no session. */
export const GET = defineHandler((c) => {
  const user = requireAuth(c)
  return { email: user.email }
})
