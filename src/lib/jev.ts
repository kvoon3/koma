/**
 * The Jev boundary. A committed label's text becomes one Choice question over
 * the leading-icon catalog, and the answer names an icon or "none".
 *
 * Contract, checked against the local mock; the live endpoint answers 451 in
 * this region:
 *
 * - POST the configured URL with `application/json`. The body names the model
 *   `jev-latest`, carries the label text as `state`, and asks one Choice
 *   question whose criteria are the icon ids, each described by its English
 *   label text, plus a `none` option.
 * - `Authorization: Bearer <key>` when a key is set locally.
 * - JSON answer
 *   `{ answers: { label_icon: { type: 'choice', choice, confidence } } }`.
 *
 * A production build with no explicit URL posts to the same-origin proxy at
 * `JEV_PROXY_PATH` and never sends a client key. The Worker owns the secret.
 */

/** A hung request must not keep the pick waiting forever. */
export const JEV_TIMEOUT_MS = 20_000

/** Where a production build without an explicit URL sends the request. */
export const JEV_PROXY_PATH = '/api/jev'

/** The model alias the API resolves to a concrete build. */
export const JEV_MODEL = 'jev-latest'

/** The one question this boundary asks. */
export const JEV_QUESTION_ID = 'label_icon'

/** The Choice option meaning the label keeps no icon. */
export const JEV_NONE_CHOICE = 'none'

/** What the model is asked. The label text is in `state`. */
export const JEV_LABEL_ICON_INSTRUCTIONS
  = 'Pick the one leading icon that best fits the label text. Choose "none" when no icon fits. The label text may be in any language.'

/** The description of the no-icon option, set beside the icon descriptions. */
export const JEV_NONE_DESCRIPTION = 'No icon fits; leave the label as text only.'

/** Relative paths resolve against the page, or this in a non-browser test. */
const FALLBACK_ORIGIN = 'http://localhost'

/** One leading icon a Choice may select. */
export interface LabelIconCandidate {
  /** The stored icon id, which is also the Choice option name. */
  id: string
  /** The icon's English label text, which is the option description. */
  description: string
}

/** A well-formed answer, pinned by the parser test. */
export const JEV_RESPONSE_FIXTURE = {
  model: 'jev-1.14.0',
  answers: {
    label_icon: {
      type: 'choice',
      choice: 'cake',
      confidence: 0.96,
    },
  },
  usage: { input_tokens: 220, output_tokens: 3 },
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

/** A protocol-relative `//host` is refused; a single-slash path resolves against the page. */
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

export type JevFailureReason = 'http' | 'malformed' | 'shape' | 'empty' | 'network' | 'timeout' | 'aborted'

export interface LabelIconPick {
  /** The chosen icon id, or null for the "none" option. */
  icon: string | null
  /**
   * The Choice confidence. This is distribution concentration, not permission:
   * a leading icon is a harmless preference, so any valid pick applies.
   */
  confidence: number
}

export type LabelIconResult
  = | { ok: true, pick: LabelIconPick }
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

export interface LabelIconRequestDocument {
  model: string
  state: string
  questions: Record<string, {
    type: 'choice'
    instructions: string
    criteria: Record<string, string>
  }>
}

export function labelIconRequest(
  text: string,
  candidates: readonly LabelIconCandidate[],
): LabelIconRequestDocument {
  const criteria: Record<string, string> = {}
  for (const candidate of candidates)
    criteria[candidate.id] = candidate.description
  criteria[JEV_NONE_CHOICE] = JEV_NONE_DESCRIPTION

  return {
    model: JEV_MODEL,
    state: text,
    questions: {
      [JEV_QUESTION_ID]: {
        type: 'choice',
        instructions: JEV_LABEL_ICON_INSTRUCTIONS,
        criteria,
      },
    },
  }
}

export function buildJevRequest(
  text: string,
  candidates: readonly LabelIconCandidate[],
  config: JevConfig,
): { url: string, init: RequestInit } {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  }
  if (config.key)
    headers.Authorization = `Bearer ${config.key}`
  return {
    url: config.url.toString(),
    init: { method: 'POST', body: JSON.stringify(labelIconRequest(text, candidates)), headers },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A confidence is a finite probability in [0, 1]. */
function readConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return null
  return value >= 0 && value <= 1 ? value : null
}

/**
 * Status first, so a JSON error page is an `http` failure, not a shape one. An
 * unknown option name is a shape fault: only a catalog id or `none` may land
 * on a label.
 */
export function parseLabelIconResponse(
  status: number,
  body: string,
  candidates: readonly string[],
): LabelIconResult {
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

  const answer = data.answers[JEV_QUESTION_ID]
  if (!isRecord(answer) || answer.type !== 'choice' || typeof answer.choice !== 'string')
    return { ok: false, reason: 'shape' }

  const confidence = readConfidence(answer.confidence)
  if (confidence === null)
    return { ok: false, reason: 'shape' }

  if (answer.choice === JEV_NONE_CHOICE)
    return { ok: true, pick: { icon: null, confidence } }

  if (!candidates.includes(answer.choice))
    return { ok: false, reason: 'shape' }

  return { ok: true, pick: { icon: answer.choice, confidence } }
}

export interface PickLabelIconOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export async function pickLabelIcon(
  text: string,
  candidates: readonly LabelIconCandidate[],
  config: JevConfig,
  opts: PickLabelIconOptions = {},
): Promise<LabelIconResult> {
  if (!text.trim())
    return { ok: false, reason: 'empty' }

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
    const { url, init } = buildJevRequest(text, candidates, config)
    const res = await fetch(url, { ...init, signal: controller.signal })
    const body = await res.text()
    return parseLabelIconResponse(res.status, body, candidates.map(candidate => candidate.id))
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
