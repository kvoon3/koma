import { defineHandler } from 'void'
import { env } from 'void/env'
import { proxy } from '../_jev'

// Only POST is exported, so every other method on this path is answered by
// the router, not the SPA fallback.
/** Post a Jev request body through to the configured upstream. */
export const POST = defineHandler(c => proxy(c.req.raw, env.JEV_API_URL, env.JEV_API_KEY))
