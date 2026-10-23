/// <reference types="bun" />
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import worker, { JEV_PATH, MAX_BODY_BYTES } from './index'

type Env = Parameters<typeof worker.fetch>[1]

interface Received {
  method: string
  path: string
  auth: string | null
  accept: string | null
  dangerZone: string | null
  contentType: string | null
  requestType: string | null
  request: unknown
  image: Uint8Array | null
  filename: string | null
}

const ANSWER = JSON.stringify({
  model: 'jev-1.14.0',
  answers: { person: { type: 'noul', noul: 0.99 } },
  usage: { input_tokens: 2003, output_tokens: 53 },
})

let upstream: ReturnType<typeof Bun.serve>
let received: Received | null = null
let calls = 0
let reply = { status: 200, type: 'application/json', body: ANSWER }

beforeAll(() => {
  upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      calls++
      const form = await request.formData()
      const image = form.get('photo')
      const requestPart = form.get('request')
      let parsed: unknown = null
      if (requestPart instanceof Blob) {
        try {
          parsed = JSON.parse(await requestPart.text())
        }
        catch {}
      }
      received = {
        method: request.method,
        path: new URL(request.url).pathname,
        auth: request.headers.get('authorization'),
        accept: request.headers.get('accept'),
        dangerZone: request.headers.get('typesafe-danger-zone-images'),
        contentType: request.headers.get('content-type'),
        requestType: requestPart instanceof Blob ? requestPart.type : null,
        request: parsed,
        image: image instanceof Blob ? new Uint8Array(await image.arrayBuffer()) : null,
        filename: image instanceof File ? image.name : null,
      }
      return new Response(reply.body, { status: reply.status, headers: { 'content-type': reply.type } })
    },
  })
})

afterAll(() => upstream.stop(true))

beforeEach(() => {
  received = null
  calls = 0
  reply = { status: 200, type: 'application/json', body: ANSWER }
})

function environment(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {
      fetch: async request => new Response(`asset ${new URL(request.url).pathname}`, { status: 200 }),
    },
    JEV_API_URL: `http://127.0.0.1:${upstream.port}/classify`,
    JEV_API_KEY: 'server-key',
    ...overrides,
  }
}

const REQUEST_BODY = {
  model: 'jev-latest',
  state: { photo: 'photo' },
  assets: { photo: { type: 'image', part: 'photo' } },
  questions: {
    person: {
      type: 'noul',
      instructions: 'Does this photo show a person?',
      criteria: { true: 'A person is visible.', false: 'No person is visible.' },
    },
  },
}

function photoRequest(headers: Record<string, string> = {}): Request {
  const form = new FormData()
  form.append('request', new Blob([JSON.stringify(REQUEST_BODY)], { type: 'application/json' }), 'request.json')
  form.append('photo', new File(['pixels'], 'photo.jpg', { type: 'image/jpeg' }))
  return new Request(`https://app.example${JEV_PATH}`, { method: 'POST', body: form, headers })
}

function apiRequest(method = 'POST', headers: Record<string, string> = {}, body?: BodyInit): Request {
  return new Request(`https://app.example${JEV_PATH}`, { method, headers, body })
}

describe('the proxy forwards the photo and owns the key', () => {
  test('the multipart body crosses with the server Authorization and the image header', async () => {
    const response = await worker.fetch(photoRequest({ authorization: 'Bearer client-key' }), environment())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(ANSWER)
    expect(received).toMatchObject({
      method: 'POST',
      path: '/classify',
      auth: 'Bearer server-key',
      accept: 'application/json',
      dangerZone: 'true',
      filename: 'photo.jpg',
    })
    expect(received?.contentType?.startsWith('multipart/form-data; boundary=')).toBe(true)
    expect(received?.requestType?.startsWith('application/json')).toBe(true)
    expect(received?.request).toEqual(REQUEST_BODY)
    expect(new TextDecoder().decode(received?.image ?? new Uint8Array())).toBe('pixels')
  })

  test('the upstream status, content type and body pass through', async () => {
    reply = { status: 418, type: 'text/plain', body: 'not a teapot' }
    const response = await worker.fetch(photoRequest(), environment())
    expect(response.status).toBe(418)
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(await response.text()).toBe('not a teapot')
  })

  test('query parameters cannot choose the upstream', async () => {
    const request = new Request(`https://app.example${JEV_PATH}?url=https://evil.example/steal`, {
      method: 'POST',
      body: new FormData(),
    })
    await worker.fetch(request, environment())
    expect(received?.path).toBe('/classify')
  })
})

describe('the boundaries', () => {
  test('a missing URL or key answers 503 unconfigured and calls nothing', async () => {
    for (const overrides of [{ JEV_API_URL: undefined }, { JEV_API_KEY: undefined }, { JEV_API_KEY: '  ' }]) {
      const response = await worker.fetch(photoRequest(), environment(overrides))
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'unconfigured' })
    }
    expect(calls).toBe(0)
  })

  test('only POST is allowed', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await worker.fetch(apiRequest(method), environment())
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
    }
    expect(calls).toBe(0)
  })

  test('a body above the cap answers 413 and calls nothing', async () => {
    const body = new Uint8Array(MAX_BODY_BYTES + 1)
    const response = await worker.fetch(apiRequest('POST', {}, body), environment())
    expect(response.status).toBe(413)
    expect(calls).toBe(0)
  })

  test('a chunked body above the cap answers 413 without a content length', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_BODY_BYTES) {
          controller.close()
          return
        }
        sent += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const request = new Request(`https://app.example${JEV_PATH}`, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    expect(request.headers.get('content-length')).toBeNull()
    const response = await worker.fetch(request, environment())
    expect(response.status).toBe(413)
    expect(calls).toBe(0)
  })

  test('every other path goes to the assets binding unchanged', async () => {
    const request = new Request('https://app.example/board?pane=2')
    const response = await worker.fetch(request, environment())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('asset /board')
    expect(calls).toBe(0)
  })
})
