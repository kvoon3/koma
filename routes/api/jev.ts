import { defineHandler } from 'void'
import { env } from '../../env'
import { proxy } from '../_jev'

// Only POST is exported. Other methods on this path fall through to the SPA
// shell (measured: GET answers 200 text/html); nothing consumes them.
/** Post a Jev request body through to the configured upstream. */
export const POST = defineHandler(c => proxy(c.req.raw, env.JEV_API_URL, env.JEV_API_KEY))
