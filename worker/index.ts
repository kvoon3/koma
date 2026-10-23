/**
 * The Jev proxy. The API key is a Worker secret, so it never enters the
 * public bundle. The client posts multipart to `/api/jev`, this handler swaps
 * the Authorization header for the server key, and the answer streams back
 * unchanged.
 *
 * The upstream URL is always `JEV_API_URL`. Nothing on the request can change
 * where the body goes.
 */

export const JEV_PATH = '/api/jev'
export const MAX_BODY_BYTES = 15 * 1024 * 1024
export const UPSTREAM_TIMEOUT_MS = 20_000

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  JEV_API_URL?: string
  JEV_API_KEY?: string
}

type BodyRead
  = | { ok: true, body: ArrayBuffer }
    | { ok: false, reason: 'too-large' | 'unreadable' }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })
}

/** Read at most the cap. A declared length above it is rejected without reading. */
async function readBody(request: Request): Promise<BodyRead> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return { ok: false, reason: 'too-large' }
  if (!request.body)
    return { ok: true, body: new ArrayBuffer(0) }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done)
        break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        return { ok: false, reason: 'too-large' }
      }
      chunks.push(value)
    }
  }
  catch {
    return { ok: false, reason: 'unreadable' }
  }

  const buffer = new ArrayBuffer(total)
  const body = new Uint8Array(buffer)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, body: buffer }
}

function configuredUrl(raw: string | undefined): URL | null {
  const value = raw?.trim()
  if (!value)
    return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  }
  catch {
    return null
  }
}

async function proxy(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST')
    return json(405, { error: 'method not allowed' }, { allow: 'POST' })

  const upstream = configuredUrl(env.JEV_API_URL)
  const key = env.JEV_API_KEY?.trim()
  if (!upstream || !key)
    return json(503, { error: 'unconfigured' })

  const read = await readBody(request)
  if (!read.ok) {
    return read.reason === 'too-large'
      ? json(413, { error: 'payload too large' })
      : json(400, { error: 'unreadable body' })
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${key}`,
  }
  const contentType = request.headers.get('content-type')
  if (contentType)
    headers['content-type'] = contentType

  let response: Response
  try {
    response = await fetch(upstream, {
      method: 'POST',
      headers,
      body: read.body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  }
  catch (error) {
    const timedOut = error instanceof DOMException
      && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return timedOut ? json(504, { error: 'timeout' }) : json(502, { error: 'upstream' })
  }

  const out: Record<string, string> = { 'cache-control': 'no-store' }
  const upstreamType = response.headers.get('content-type')
  if (upstreamType)
    out['content-type'] = upstreamType
  return new Response(response.body, { status: response.status, headers: out })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    return pathname === JEV_PATH ? proxy(request, env) : env.ASSETS.fetch(request)
  },
}
