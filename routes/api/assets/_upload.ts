/**
 * The upload wire format and its validation, kept out of the route so the
 * handler stays a thin shell around R2 and D1. This is the only place a
 * client body, header, or id becomes typed.
 *
 * A request is a UTF-8 JSON head, one newline, then the file's bytes. Metadata
 * rides in the body rather than a header because a sticker's `meta` carries its
 * maker record, whose original image is a data URL; that can pass anyone's
 * header limit while the file still needs to stream. The newline is safe as a
 * separator: `JSON.stringify` escapes newlines inside strings, so the first
 * raw newline ends the head.
 */
import { ASSET_MAX_MB, isAssetId } from '../../../src/lib/assetKeys'

/** The per-file cap. Streaming into R2 keeps worker memory at one chunk. */
export const MAX_ASSET_BYTES = ASSET_MAX_MB * 1024 * 1024

/** The head cap: comfortably above a 1600px sticker original, far below memory risk. */
export const MAX_HEAD_BYTES = 2 * 1024 * 1024

export const MAX_NAME_CHARS = 255

const MAX_DIMENSION = 100_000

export type AssetKind = 'photo' | 'sticker' | 'music'

function isKind(value: string): value is AssetKind {
  switch (value) {
    case 'photo':
    case 'sticker':
    case 'music':
      return true
    default:
      return false
  }
}

const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+$/

export interface UploadHead {
  id: string
  kind: AssetKind
  name: string
  trueW: number
  trueH: number
  meta: string | null
  contentType: string
}

export type UploadRead
  = | { ok: true, head: UploadHead, body: ReadableStream<Uint8Array>, size: number }
    | { ok: false, status: 400 | 411 | 413, error: string }

/** Raised by the stream when the arriving bytes pass the cap despite the declared length. */
export class AssetTooLargeError extends Error {
  constructor() {
    super('asset too large')
    this.name = 'AssetTooLargeError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_DIMENSION
    ? value
    : null
}

export type ParsedHead
  = | { ok: true, value: UploadHead }
    | { ok: false }

/** Validate the JSON head: every field the row and the serve response need. */
export function parseUploadHead(value: unknown): ParsedHead {
  if (!isRecord(value))
    return { ok: false }
  const { id, kind, name, type } = value
  const trueW = readDimension(value.trueW)
  const trueH = readDimension(value.trueH)
  if (typeof id !== 'string' || !isAssetId(id))
    return { ok: false }
  if (typeof kind !== 'string' || !isKind(kind))
    return { ok: false }
  if (typeof name !== 'string')
    return { ok: false }
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_CHARS || trueW === null || trueH === null)
    return { ok: false }
  let meta: string | null = null
  if (value.meta !== undefined && value.meta !== null) {
    if (typeof value.meta !== 'string' || new TextEncoder().encode(value.meta).byteLength > MAX_HEAD_BYTES)
      return { ok: false }
    let parsed: unknown
    try {
      parsed = JSON.parse(value.meta)
    }
    catch {
      return { ok: false }
    }
    if (!isRecord(parsed))
      return { ok: false }
    meta = value.meta
  }
  const contentType = typeof type === 'string' && type.length <= 100 && CONTENT_TYPE.test(type)
    ? type
    : 'application/octet-stream'
  return { ok: true, value: { id, kind, name: trimmed, trueW, trueH, meta, contentType } }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (a.byteLength === 0)
    return new Uint8Array(b)
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a)
  out.set(b, a.byteLength)
  return out
}

/**
 * Split the head from the bytes and hand back a stream still backed by the
 * request. R2 needs a stream of known length, so a declared `content-length` is
 * required (the browser's Blob body always has one) and the returned `size` is
 * exactly the file bytes the route wraps in a `FixedLengthStream`. The cap is
 * enforced on both the declared length and the bytes that actually arrive, so
 * a lying length costs an aborted R2 write, not memory.
 */
export async function readUploadBody(
  source: ReadableStream<Uint8Array> | null,
  declaredLength: number | null,
): Promise<UploadRead> {
  if (declaredLength === null)
    return { ok: false, status: 411, error: 'length-required' }
  if (declaredLength > MAX_ASSET_BYTES + MAX_HEAD_BYTES + 1)
    return { ok: false, status: 413, error: 'too-large' }
  if (!source)
    return { ok: false, status: 400, error: 'invalid-body' }

  const reader = source.getReader()
  let buffered: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  let headEnd = -1
  while (headEnd < 0) {
    let chunk: Awaited<ReturnType<typeof reader.read>>
    try {
      chunk = await reader.read()
    }
    catch {
      await reader.cancel().catch(() => {})
      return { ok: false, status: 400, error: 'unreadable-body' }
    }
    if (chunk.done) {
      await reader.cancel().catch(() => {})
      return { ok: false, status: 400, error: 'invalid-body' }
    }
    buffered = concat(buffered, chunk.value)
    if (buffered.byteLength > MAX_HEAD_BYTES) {
      await reader.cancel().catch(() => {})
      return { ok: false, status: 413, error: 'head-too-large' }
    }
    headEnd = buffered.indexOf(0x0A)
  }

  let head: ParsedHead
  try {
    head = parseUploadHead(JSON.parse(new TextDecoder().decode(buffered.subarray(0, headEnd))))
  }
  catch {
    head = { ok: false }
  }
  if (!head.ok) {
    await reader.cancel().catch(() => {})
    return { ok: false, status: 400, error: 'invalid-head' }
  }

  const size = declaredLength - headEnd - 1
  if (size < 0) {
    await reader.cancel().catch(() => {})
    return { ok: false, status: 400, error: 'invalid-body' }
  }
  if (size > MAX_ASSET_BYTES) {
    await reader.cancel().catch(() => {})
    return { ok: false, status: 413, error: 'too-large' }
  }

  let received = buffered.byteLength - headEnd - 1
  if (received > MAX_ASSET_BYTES) {
    await reader.cancel().catch(() => {})
    return { ok: false, status: 413, error: 'too-large' }
  }
  let rest: Uint8Array<ArrayBuffer> | null = buffered.subarray(headEnd + 1)

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (rest && rest.byteLength > 0)
        controller.enqueue(new Uint8Array(rest))
      rest = null
    },
    async pull(controller) {
      let chunk: Awaited<ReturnType<typeof reader.read>>
      try {
        chunk = await reader.read()
      }
      catch {
        controller.error(new Error('unreadable body'))
        return
      }
      if (chunk.done) {
        controller.close()
        return
      }
      received += chunk.value.byteLength
      if (received > MAX_ASSET_BYTES) {
        await reader.cancel().catch(() => {})
        controller.error(new AssetTooLargeError())
        return
      }
      controller.enqueue(new Uint8Array(chunk.value))
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })

  return { ok: true, head: head.value, body, size }
}
