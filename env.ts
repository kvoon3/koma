import { defineEnv, string } from 'void/env'

const typed = defineEnv({
  JEV_API_URL: string().optional(),
  JEV_API_KEY: string().optional(),
})

/**
 * The proxy's server values, validated at the boundary instead of here: a
 * `url()` validator would make void throw at request time for a malformed
 * value (a dashboard rotation without a scheme), 500ing the whole worker,
 * while `configuredUrl` in `routes/_jev.ts` degrades to a 503 on the proxy
 * alone. `void secret put` sets them remotely.
 */
export default typed

/**
 * The typed accessor void documents for the explicit-import pattern: route
 * code reads `string | undefined` from here instead of the ambient
 * `void/env` export, whose types come from the gitignored `.void/env.d.ts`
 * a fresh checkout does not have yet.
 */
export const env = typed
