/// <reference types="bun" />
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { MAX_BODY_BYTES, proxy } from './_jev'

const JEV_PATH = '/api/jev'

interface Received {
  method: string
  path: string
  auth: string | null
  accept: string | null
  dangerZone: string | null
  contentType: string | null
  body: unknown
}

const ANSWER = JSON.stringify({
  model: 'jev-1.14.0',
  answers: { label_icon: { type: 'choice', choice: 'cake', confidence: 0.96 } },
  usage: { input_tokens: 220, output_tokens: 3 },
})

const REQUEST_BODY = {
  model: 'jev-latest',
  state: '生日蛋糕',
  questions: {
    label_icon: {
      type: 'choice',
      instructions: 'Pick the one leading icon that best fits the label text.',
      criteria: { cake: 'Cake', none: 'No icon fits; leave the label as text only.' },
    },
  },
}

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
      const raw = await request.text()
      let parsed: unknown = null
      try {
        parsed = JSON.parse(raw)
      }
      catch {}
      received = {
        method: request.method,
        path: new URL(request.url).pathname,
        auth: request.headers.get('authorization'),
        accept: request.headers.get('accept'),
        dangerZone: request.headers.get('typesafe-danger-zone-images'),
        contentType: request.headers.get('content-type'),
        body: parsed,
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

function call(request: Request): Promise<Response> {
  return proxy(request, `http://127.0.0.1:${upstream.port}/v1/systemone`, 'server-key')
}

function jsonRequest(
  headers: Record<string, string> = { 'content-type': 'application/json' },
  body: BodyInit = JSON.stringify(REQUEST_BODY),
): Request {
  return new Request(`https://app.example${JEV_PATH}`, { method: 'POST', headers, body })
}

describe('the proxy forwards the JSON and owns the key', () => {
  test('the body crosses unchanged with the server Authorization', async () => {
    const response = await call(jsonRequest({ 'content-type': 'application/json', 'authorization': 'Bearer client-key' }))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(ANSWER)
    expect(received).toMatchObject({
      method: 'POST',
      path: '/v1/systemone',
      auth: 'Bearer server-key',
      accept: 'application/json',
      contentType: 'application/json',
      dangerZone: null,
    })
    expect(received?.body).toEqual(REQUEST_BODY)
  })

  test('an absent content type is not invented', async () => {
    await call(jsonRequest({}))
    expect(received?.contentType).toBeNull()
  })

  test('the upstream status, content type and body pass through', async () => {
    reply = { status: 418, type: 'text/plain', body: 'not a teapot' }
    const response = await call(jsonRequest())
    expect(response.status).toBe(418)
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(await response.text()).toBe('not a teapot')
  })

  test('query parameters cannot choose the upstream', async () => {
    const request = new Request(`https://app.example${JEV_PATH}?url=https://evil.example/steal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REQUEST_BODY),
    })
    await call(request)
    expect(received?.path).toBe('/v1/systemone')
  })
})

describe('the boundaries', () => {
  test('a missing URL or key answers 503 unconfigured and calls nothing', async () => {
    const upstreamUrl = `http://127.0.0.1:${upstream.port}/v1/systemone`
    for (const [url, key] of [[undefined, 'server-key'], [upstreamUrl, undefined], [upstreamUrl, '  ']] as const) {
      const response = await proxy(jsonRequest(), url, key)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'unconfigured' })
    }
    expect(calls).toBe(0)
  })

  test('a body above the cap answers 413 and calls nothing', async () => {
    const body = new Uint8Array(MAX_BODY_BYTES + 1)
    const response = await call(jsonRequest({}, body))
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
    const response = await call(request)
    expect(response.status).toBe(413)
    expect(calls).toBe(0)
  })
})
