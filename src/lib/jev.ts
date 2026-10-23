/**
 * The Jev boundary. The photo becomes a System One request with one Noul
 * question per tag category, and the answers come back as tag labels.
 *
 * Contract, pinned to the live TypeSafe API:
 *
 * - POST the configured URL with `multipart/form-data`. The first part is
 *   `request`, a JSON document with `content-type: application/json`. The image
 *   travels as its own `photo` part, named by the `photo` asset.
 * - `Authorization: Bearer <key>` when a key is set locally.
 * - `TypeSafe-Danger-Zone-Images: true` whenever an image is present.
 * - JSON answer `{ model, answers: { [id]: { type: 'noul', noul: number } } }`.
 *
 * A production build with no explicit URL posts to the same-origin proxy at
 * `JEV_PROXY_PATH` and never sends a client key. The Worker owns the secret.
 */
import { cleanEntryName, sameEntryName } from './assetNames'
import { JEV_CATEGORIES } from './jevTaxonomy'
import { MAX_TAG_NAME } from './photoTags'

/** Chips stay scannable, so one answer never floods the tag editor. */
export const MAX_JEV_LABELS = 8

/** A hung request must not hold the dialog's Classify button forever. */
export const JEV_TIMEOUT_MS = 20_000

/** Where a production build without an explicit URL sends the photo. */
export const JEV_PROXY_PATH = '/api/jev'

/** The model alias the API resolves to a concrete build. */
export const JEV_MODEL = 'jev-latest'

/** The multipart part that holds the JSON document. */
export const JEV_REQUEST_PART = 'request'

/** The multipart part that holds the image, and the asset ref that names it. */
export const JEV_IMAGE_PART = 'photo'
export const JEV_IMAGE_REF = 'photo'

/** The header TypeSafe requires whenever the request carries an image. */
export const JEV_IMAGE_HEADER = 'TypeSafe-Danger-Zone-Images'

/** A Noul probability at or above this value becomes a suggested tag. */
export const JEV_NOUL_THRESHOLD = 0.7

/** The image the API accepts: a JPEG inside these dimensions and pixel counts. */
export const JEV_LONG_EDGE = 1024
export const JEV_SHORT_EDGE = 280
export const JEV_SIDE_LIMIT = 1568
export const JEV_MIN_PIXELS = 78_400
export const JEV_MAX_PIXELS = 2_458_624
export const JEV_JPEG_QUALITY = 0.9

/** The padding color behind a letterboxed image. */
export const JEV_LETTERBOX_COLOR = '#7f7f7f'

/** Relative paths resolve against the page, or this in a non-browser test. */
const FALLBACK_ORIGIN = 'http://localhost'

/** A well-formed answer, pinned by the parser test. */
export const JEV_RESPONSE_FIXTURE = {
  model: 'jev-1.14.0',
  answers: {
    person: { type: 'noul', noul: 0.99 },
    beach: { type: 'noul', noul: 0.96 },
    food: { type: 'noul', noul: 0.08 },
  },
  usage: { input_tokens: 2003, output_tokens: 53 },
} as const

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

export interface JevImageBox {
  width: number
  height: number
}

/**
 * The canvas size for an image of `w` by `h`. The long edge is at most
 * `JEV_LONG_EDGE`, so the box never approaches the API's 1568 side limit. When
 * the scaled short edge is under `JEV_SHORT_EDGE`, the box is padded instead of
 * upscaling the wide edge past the cap. Both sides end at 280 or more, so the
 * pixel count stays above `JEV_MIN_PIXELS`, and 1024 squared keeps it below
 * `JEV_MAX_PIXELS`.
 */
export function jevImageBox(w: number, h: number): JevImageBox {
  const safeW = Number.isFinite(w) && w > 0 ? w : 1
  const safeH = Number.isFinite(h) && h > 0 ? h : 1
  const long = Math.max(safeW, safeH)
  const short = Math.min(safeW, safeH)

  // Shrink a large image to the long-edge cap. A small one stays as it is
  // unless its short edge needs the minimum.
  let scale = Math.min(1, JEV_LONG_EDGE / long)
  if (short * scale < JEV_SHORT_EDGE)
    scale = Math.min(JEV_LONG_EDGE / long, JEV_SHORT_EDGE / short)

  const width = Math.max(JEV_SHORT_EDGE, Math.round(safeW * scale))
  const height = Math.max(JEV_SHORT_EDGE, Math.round(safeH * scale))
  return {
    width: Math.min(width, JEV_LONG_EDGE),
    height: Math.min(height, JEV_LONG_EDGE),
  }
}

/**
 * Redraw the preview onto a neutral canvas and export JPEG. The browser owns
 * the decode, so an unreadable image rejects here.
 */
export async function prepareJevImage(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image)
  try {
    const box = jevImageBox(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = box.width
    canvas.height = box.height
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error('no 2d canvas')

    context.fillStyle = JEV_LETTERBOX_COLOR
    context.fillRect(0, 0, box.width, box.height)

    // The box was sized from this aspect, so the content fills at least one
    // axis and the other axis is the letterbox.
    const scale = Math.min(box.width / bitmap.width, box.height / bitmap.height)
    const drawWidth = Math.max(1, Math.round(bitmap.width * scale))
    const drawHeight = Math.max(1, Math.round(bitmap.height * scale))
    context.drawImage(
      bitmap,
      Math.floor((box.width - drawWidth) / 2),
      Math.floor((box.height - drawHeight) / 2),
      drawWidth,
      drawHeight,
    )

    const out = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JEV_JPEG_QUALITY))
    if (!out)
      throw new Error('jpeg export failed')
    return out
  }
  finally {
    bitmap.close()
  }
}

export interface JevRequestDocument {
  model: string
  state: { photo: string }
  assets: Record<string, { type: 'image', part: string }>
  questions: Record<string, {
    type: 'noul'
    instructions: string
    criteria: { true: string, false: string }
  }>
}

/** One Noul question per category, keyed by the icon id. */
export function jevRequestDocument(): JevRequestDocument {
  return {
    model: JEV_MODEL,
    state: { photo: JEV_IMAGE_REF },
    assets: { [JEV_IMAGE_REF]: { type: 'image', part: JEV_IMAGE_PART } },
    questions: Object.fromEntries(JEV_CATEGORIES.map(category => [category.id, {
      type: 'noul' as const,
      instructions: category.instruction,
      criteria: { true: category.criteria.true, false: category.criteria.false },
    }])),
  }
}

export function buildJevRequest(image: Blob, config: JevConfig): { url: string, init: RequestInit } {
  const form = new FormData()
  form.append(JEV_REQUEST_PART, new Blob([JSON.stringify(jevRequestDocument())], { type: 'application/json' }), 'request.json')
  form.append(JEV_IMAGE_PART, image, 'photo.jpg')

  const headers: Record<string, string> = {
    Accept: 'application/json',
    [JEV_IMAGE_HEADER]: 'true',
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A Noul is a finite probability in [0, 1]. Anything else is a shape fault. */
function readNoul(answer: unknown): number | null {
  if (!isRecord(answer) || answer.type !== 'noul' || typeof answer.noul !== 'number')
    return null
  const value = answer.noul
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

/**
 * Status first, so a JSON error page is an `http` failure, not a shape one.
 * Only taxonomy ids are read, so a future question type cannot leak a chip.
 */
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

  if (!isRecord(data) || !isRecord(data.answers))
    return { ok: false, reason: 'shape' }

  const scored: { label: string, score: number }[] = []
  for (const category of JEV_CATEGORIES) {
    const answer = data.answers[category.id]
    if (answer === undefined)
      continue
    const score = readNoul(answer)
    if (score === null)
      return { ok: false, reason: 'shape' }
    if (score >= JEV_NOUL_THRESHOLD)
      scored.push({ label: category.label, score })
  }

  if (scored.length === 0)
    return { ok: false, reason: 'empty' }

  scored.sort((a, b) => b.score - a.score)
  const labels = cleanJevLabels(scored.map(entry => entry.label))
  return labels.length > 0
    ? { ok: true, labels }
    : { ok: false, reason: 'empty' }
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
    let prepared: Blob
    try {
      prepared = await prepareJevImage(image)
    }
    catch {
      if (externallyAborted)
        return { ok: false, reason: 'aborted' }
      if (timedOut)
        return { ok: false, reason: 'timeout' }
      // An unreadable preview never reached the wire, so it is a shape fault
      // on the input side rather than a network one.
      return { ok: false, reason: 'shape' }
    }

    const { url, init } = buildJevRequest(prepared, config)
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
