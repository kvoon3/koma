import { defineEnv, string, url } from 'void/env'

/** The proxy's server values. `void secret put` sets them remotely. */
export default defineEnv({
  // Optional on purpose: an unconfigured deployment answers 503 from the
  // proxy instead of failing Worker startup.
  JEV_API_URL: url().optional(),
  JEV_API_KEY: string().optional(),
})
