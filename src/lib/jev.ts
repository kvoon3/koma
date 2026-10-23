/**
 * The Jev classification boundary. Pinning the real API later is a change in
 * this file alone.
 *
 * Assumed contract (provisional until the operator supplies the Jev docs):
 *
 * - POST `VITE_JEV_API_URL` with `multipart/form-data`, the photo under the
 *   field `image`.
 * - `Authorization: Bearer <VITE_JEV_API_KEY>` when a key is set locally.
 * - JSON answer `{ "labels": string[] }`.
 *
 * A production build with no explicit URL posts to the same-origin proxy at
 * `JEV_PROXY_PATH` and never sends a client key. The Worker owns the secret.
 */
import { cleanEntryName, sameEntryName } from './assetNames'
import { MAX_TAG_NAME } from './photoTags'

/** Chips stay scannable, so one answer never floods the tag editor. */
export const MAX_JEV_LABELS = 8

/** A hung request must not hold the dialog's Classify button forever. */
export const JEV_TIMEOUT_MS = 20_000

/** The multipart field the photo travels under. */
export const JEV_IMAGE_FIELD = 'image'

/** Where a production build without an explicit URL sends the photo. */
export const JEV_PROXY_PATH = '/api/jev'

/** Relative paths resolve against the page, or this in a non-browser test. */
const FALLBACK_ORIGIN = 'http://localhost'

/** The assumed answer, pinned by the parser test until the real shape lands. */
export const JEV_RESPONSE_FIXTURE: Readonly<{ labels: string[] }> = {
  labels: ['person', 'beach', 'food'],
}

export interface JevConfig {
  url: URL
  key: string | null
}

export interface JevEnv {
  /** True for `vite build`, false for the dev server. */
  readonly PROD?: boolean
  readonly VITE_JEV_API_URL?: string
  readonly VITE_JEV_API_KEY?: string
}

/**
 * Property access only. A bare `import.meta.env` would inline every VITE_
 * value, including the local-only key, into the public bundle.
 */
function runtimeEnv(): JevEnv {
  return {
    PROD: import.meta.env.PROD,
    VITE_JEV_API_URL: import.meta.env.VITE_JEV_API_URL,
    VITE_JEV_API_KEY: import.meta.env.DEV ? import.meta.env.VITE_JEV_API_KEY : undefined,
  }
}

/** An absolute http(s) URL, or a single-slash path resolved against the page. */
function endpointUrl(raw: string): URL | null {
  if (raw.startsWith('//'))
    return null
  if (raw.startsWith('/')) {
    try {
      const url = new URL(raw, globalThis.location?.origin ?? FALLBACK_ORIGIN)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
    }
    catch {
      return null
    }
  }
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  }
  catch {
    return null
  }
}

/** The failures stay distinct so the dialog can say what went wrong. */
export type JevFailureReason = 'http' | 'malformed' | 'shape' | 'empty' | 'network' | 'timeout' | 'aborted'

export type JevResult
  = | { ok: true, labels: string[] }
    | { ok: false, reason: JevFailureReason, status?: number }

export function readJevConfig(env: JevEnv = runtimeEnv()): JevConfig | null {
  const explicit = env.VITE_JEV_API_URL?.trim()
  const raw = explicit || (env.PROD === true ? JEV_PROXY_PATH : '')
  if (!raw)
    return null
  const url = endpointUrl(raw)
  if (!url)
    return null
  // Production never sends the key. The Worker supplies it.
  const key = env.PROD === true ? null : env.VITE_JEV_API_KEY?.trim()
  return { url, key: key || null }
}

function imageName(image: Blob): string {
  return image.type === 'image/png' ? 'photo.png' : 'photo.jpg'
}

export function buildJevRequest(image: Blob, config: JevConfig): { url: string, init: RequestInit } {
  const form = new FormData()
  form.set(JEV_IMAGE_FIELD, image, imageName(image))
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (config.key)
    headers.Authorization = `Bearer ${config.key}`
  return { url: config.url.toString(), init: { method: 'POST', body: form, headers } }
}

export function cleanJevLabels(raw: readonly string[]): string[] {
  const out: string[] = []
  for (const entry of raw) {
    if (out.length >= MAX_JEV_LABELS)
      break
    const name = cleanEntryName(entry, MAX_TAG_NAME)
    if (name && !out.some(tag => sameEntryName(tag, name)))
      out.push(name)
  }
  return out
}

/** Status first, so a JSON error page is an `http` failure, not a shape one. */
export function parseJevResponse(status: number, body: string): JevResult {
  if (status < 200 || status >= 300)
    return { ok: false, reason: 'http', status }

  let data: unknown
  try {
    data = JSON.parse(body)
  }
  catch {
    return { ok: false, reason: 'malformed' }
  }

  if (data == null || typeof data !== 'object')
    return { ok: false, reason: 'shape' }
  const labels = (data as { labels?: unknown }).labels
  if (!Array.isArray(labels) || labels.some(label => typeof label !== 'string'))
    return { ok: false, reason: 'shape' }

  const cleaned = cleanJevLabels(labels as string[])
  if (cleaned.length === 0)
    return { ok: false, reason: 'empty' }
  return { ok: true, labels: cleaned }
}

export interface ClassifyOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export async function classifyPhoto(image: Blob, config: JevConfig, opts: ClassifyOptions = {}): Promise<JevResult> {
  const controller = new AbortController()
  let timedOut = false
  let externallyAborted = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, opts.timeoutMs ?? JEV_TIMEOUT_MS)
  const forwardAbort = () => {
    externallyAborted = true
    controller.abort()
  }
  opts.signal?.addEventListener('abort', forwardAbort, { once: true })
  if (opts.signal?.aborted)
    forwardAbort()

  try {
    const { url, init } = buildJevRequest(image, config)
    const res = await fetch(url, { ...init, signal: controller.signal })
    const body = await res.text()
    return parseJevResponse(res.status, body)
  }
  catch {
    if (externallyAborted)
      return { ok: false, reason: 'aborted' }
    if (timedOut)
      return { ok: false, reason: 'timeout' }
    return { ok: false, reason: 'network' }
  }
  finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', forwardAbort)
  }
}
