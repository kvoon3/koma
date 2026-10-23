/**
 * The proxy's contract values. They live outside `index.ts` because a Worker
 * entry module may export only its handler: workerd treats every other export
 * as an entrypoint and refuses a non-function.
 */

export const JEV_PATH = '/api/jev'

/** A label icon request is a few KB of JSON; the cap bounds an abusive client. */
export const MAX_BODY_BYTES = 64 * 1024

export const UPSTREAM_TIMEOUT_MS = 20_000
