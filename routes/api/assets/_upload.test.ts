import { describe, expect, test } from 'bun:test'
import { MAX_ASSET_BYTES, MAX_HEAD_BYTES, parseDeclaredLength, parseUploadHead, readUploadBody } from './_upload'

function head(overrides: Record<string, unknown> = {}) {
  return {
    id: 'photo-1',
    kind: 'photo',
    name: 'beach.jpg',
    trueW: 1200,
    trueH: 800,
    meta: JSON.stringify({ kind: 'photo', tags: ['trip'] }),
    type: 'image/jpeg',
    ...overrides,
  }
}

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(part)
      controller.close()
    },
  })
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done)
        return
    }
  }
  finally {
    reader.releaseLock()
  }
}

describe('parseUploadHead', () => {
  test('accepts the fields the row needs', () => {
    const parsed = parseUploadHead(head())
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.id).toBe('photo-1')
      expect(parsed.value.name).toBe('beach.jpg')
      expect(parsed.value.contentType).toBe('image/jpeg')
    }
  })

  test('rejects an unsafe id, kind, name, dimension, and meta', () => {
    expect(parseUploadHead(head({ id: '../x' })).ok).toBe(false)
    expect(parseUploadHead(head({ kind: 'video' })).ok).toBe(false)
    expect(parseUploadHead(head({ name: '   ' })).ok).toBe(false)
    expect(parseUploadHead(head({ trueW: -1 })).ok).toBe(false)
    expect(parseUploadHead(head({ meta: 'not json' })).ok).toBe(false)
    expect(parseUploadHead(head({ meta: '[1]' })).ok).toBe(false)
  })

  test('keeps an unknown content type out of the response', () => {
    const parsed = parseUploadHead(head({ type: 'image/jpeg; charset=x' }))
    expect(parsed.ok && parsed.value.contentType).toBe('application/octet-stream')
  })
})

describe('readUploadBody', () => {
  test('splits the head from the bytes and streams the file back', async () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(head())}\nhello`)
    const read = await readUploadBody(streamOf([bytes.subarray(0, 5), bytes.subarray(5)]), bytes.byteLength)
    expect(read.ok).toBe(true)
    if (!read.ok)
      return
    expect(read.head.name).toBe('beach.jpg')
    expect(await new Response(read.body).text()).toBe('hello')
  })

  test('rejects an over-cap declared length without reading', async () => {
    const read = await readUploadBody(streamOf([]), MAX_ASSET_BYTES + MAX_HEAD_BYTES + 2)
    expect(read).toEqual({ ok: false, status: 413, error: 'too-large' })
  })

  test('rejects a body with no declared length', async () => {
    const read = await readUploadBody(streamOf([new TextEncoder().encode('{}')]), null)
    expect(read).toEqual({ ok: false, status: 411, error: 'length-required' })
  })

  test('rejects a body with no head separator', async () => {
    const read = await readUploadBody(streamOf([new TextEncoder().encode('{}')]), 2)
    expect(read).toEqual({ ok: false, status: 400, error: 'invalid-body' })
  })

  test('errors the stream when the body is shorter than declared', async () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(head())}\nhel`)
    const read = await readUploadBody(streamOf([bytes]), bytes.byteLength + 1)
    expect(read.ok).toBe(true)
    if (read.ok)
      await expect(drain(read.body)).rejects.toThrow('body length')
  })

  test('errors the stream when the body is longer than declared', async () => {
    const text = `${JSON.stringify(head())}\nhel`
    const split = text.length - 2
    const declared = new TextEncoder().encode(text).byteLength - 1
    const read = await readUploadBody(streamOf([
      new TextEncoder().encode(text.slice(0, split)),
      new TextEncoder().encode(text.slice(split)),
    ]), declared)
    expect(read.ok).toBe(true)
    if (read.ok)
      await expect(drain(read.body)).rejects.toThrow('body length')
  })

  test('requires a safe integer content-length', () => {
    expect(parseDeclaredLength('12')).toBe(12)
    expect(parseDeclaredLength('12.5')).toBeNull()
    expect(parseDeclaredLength('-1')).toBeNull()
    expect(parseDeclaredLength('1e3')).toBe(1000)
    expect(parseDeclaredLength(undefined)).toBeNull()
  })

  test('rejects a fractional declared length handed in directly', async () => {
    const read = await readUploadBody(streamOf([]), 1.5)
    expect(read).toEqual({ ok: false, status: 411, error: 'length-required' })
  })
})
