/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  buildJevRequest,
  JEV_LABEL_ICON_INSTRUCTIONS,
  JEV_NONE_CHOICE,
  JEV_NONE_DESCRIPTION,
  JEV_PROXY_PATH,
  JEV_QUESTION_ID,
  JEV_RESPONSE_FIXTURE,
  JEV_TIMEOUT_MS,
  labelIconRequest,
  parseLabelIconResponse,
  pickLabelIcon,
  readJevConfig,
} from './jev'

const CANDIDATES = [
  { id: 'cake', description: 'Cake' },
  { id: 'plane', description: 'Plane' },
] as const

const CONFIG = { url: new URL('https://api.typesafe.ai/v1/systemone'), key: null }

/** Swap the global fetch for one request, typed the way Bun types its own. */
function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(input, init)) as typeof fetch
}

describe('the endpoint is configured or hidden', () => {
  test('an absent, blank or malformed URL disables the action', () => {
    expect(readJevConfig({})).toBeNull()
    expect(readJevConfig({ VITE_JEV_API_URL: '   ' })).toBeNull()
    expect(readJevConfig({ VITE_JEV_API_URL: 'not a url' })).toBeNull()
    expect(readJevConfig({ VITE_JEV_API_URL: 'ftp://jev.example/label' })).toBeNull()
  })

  test('an http(s) URL is kept, trimmed, with an optional trimmed key', () => {
    const trimmed = readJevConfig({ VITE_JEV_API_URL: ' https://jev.example/label ' })
    expect(trimmed?.url.toString()).toBe('https://jev.example/label')
    expect(trimmed?.key).toBeNull()

    const keyed = readJevConfig({
      VITE_JEV_API_URL: 'https://jev.example/label',
      VITE_JEV_API_KEY: '  s3cret  ',
    })
    expect(keyed?.url.toString()).toBe('https://jev.example/label')
    expect(keyed?.key).toBe('s3cret')
  })

  test('a relative path resolves against the page, protocol-relative is refused', () => {
    const relative = readJevConfig({ VITE_JEV_API_URL: ' /api/jev ' })
    expect(relative?.url.pathname).toBe('/api/jev')
    expect(relative?.url.origin).toBe('http://localhost')
    expect(readJevConfig({ VITE_JEV_API_URL: '//evil.example/api/jev' })).toBeNull()
  })

  test('a production build falls back to the same-origin proxy and drops the key', () => {
    const fallback = readJevConfig({ PROD: true, VITE_JEV_API_KEY: 's3cret' })
    expect(fallback?.url.pathname).toBe(JEV_PROXY_PATH)
    expect(fallback?.url.origin).toBe('http://localhost')
    expect(fallback?.key).toBeNull()

    expect(readJevConfig({ PROD: false })).toBeNull()
  })

  test('an explicit URL still wins in a production build', () => {
    const explicit = readJevConfig({ PROD: true, VITE_JEV_API_URL: 'https://mock.example/label' })
    expect(explicit?.url.toString()).toBe('https://mock.example/label')
  })
})

describe('the request is one JSON Choice', () => {
  test('the body carries the label text as state and one option per candidate', () => {
    expect(labelIconRequest('生日蛋糕', CANDIDATES)).toEqual({
      model: 'jev-latest',
      state: '生日蛋糕',
      questions: {
        [JEV_QUESTION_ID]: {
          type: 'choice',
          instructions: JEV_LABEL_ICON_INSTRUCTIONS,
          criteria: {
            cake: 'Cake',
            plane: 'Plane',
            [JEV_NONE_CHOICE]: JEV_NONE_DESCRIPTION,
          },
        },
      },
    })
  })

  test('the JSON travels with its own content type and no image header', () => {
    const { init } = buildJevRequest('生日蛋糕', CANDIDATES, CONFIG)
    const headers = init.headers as Record<string, string>
    expect(init.method).toBe('POST')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Accept).toBe('application/json')
    expect(headers['TypeSafe-Danger-Zone-Images']).toBeUndefined()
    expect(headers.Authorization).toBeUndefined()

    const body = JSON.parse(String(init.body))
    expect(body.assets).toBeUndefined()
  })

  test('the bearer rides only when a key is set', () => {
    const { init } = buildJevRequest('x', CANDIDATES, { ...CONFIG, key: 's3cret' })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer s3cret')
  })
})

describe('the parser reads the Choice answer', () => {
  const ids = CANDIDATES.map(candidate => candidate.id)

  test('the fixture picks the named icon and keeps its confidence', () => {
    expect(parseLabelIconResponse(200, JSON.stringify(JEV_RESPONSE_FIXTURE), ids))
      .toEqual({ ok: true, pick: { icon: 'cake', confidence: 0.96 } })
  })

  test('the none option is a successful answer with no icon', () => {
    const body = JSON.stringify({
      answers: { [JEV_QUESTION_ID]: { type: 'choice', choice: JEV_NONE_CHOICE, confidence: 0.8 } },
    })
    expect(parseLabelIconResponse(200, body, ids))
      .toEqual({ ok: true, pick: { icon: null, confidence: 0.8 } })
  })

  test('a low confidence still picks: concentration is not permission', () => {
    const body = JSON.stringify({
      answers: { [JEV_QUESTION_ID]: { type: 'choice', choice: 'plane', confidence: 0.01 } },
    })
    expect(parseLabelIconResponse(200, body, ids))
      .toEqual({ ok: true, pick: { icon: 'plane', confidence: 0.01 } })
  })

  test('an id outside the candidates is a shape fault', () => {
    const body = JSON.stringify({
      answers: { [JEV_QUESTION_ID]: { type: 'choice', choice: 'alien', confidence: 0.9 } },
    })
    expect(parseLabelIconResponse(200, body, ids)).toEqual({ ok: false, reason: 'shape' })
  })

  test('a malformed answer stays distinct from an http failure', () => {
    expect(parseLabelIconResponse(503, '{"answers":{}}', ids)).toEqual({ ok: false, reason: 'http', status: 503 })
    expect(parseLabelIconResponse(200, 'not json', ids)).toEqual({ ok: false, reason: 'malformed' })
    expect(parseLabelIconResponse(200, '', ids)).toEqual({ ok: false, reason: 'malformed' })
    expect(parseLabelIconResponse(200, 'null', ids)).toEqual({ ok: false, reason: 'shape' })
    expect(parseLabelIconResponse(200, '{}', ids)).toEqual({ ok: false, reason: 'shape' })
  })

  test('a missing or wrong-typed answer is a shape fault', () => {
    const cases = [
      {},
      { [JEV_QUESTION_ID]: { type: 'noul', choice: 'cake', confidence: 0.9 } },
      { [JEV_QUESTION_ID]: { type: 'choice', confidence: 0.9 } },
      { [JEV_QUESTION_ID]: { type: 'choice', choice: 7, confidence: 0.9 } },
      { [JEV_QUESTION_ID]: { type: 'choice', choice: 'cake', confidence: 'high' } },
      { [JEV_QUESTION_ID]: { type: 'choice', choice: 'cake', confidence: 1.1 } },
    ]
    for (const answers of cases)
      expect(parseLabelIconResponse(200, JSON.stringify({ answers }), ids)).toEqual({ ok: false, reason: 'shape' })
  })
})

describe('the pick is one fetch with one timeout', () => {
  test('empty text never reaches the wire', async () => {
    const realFetch = globalThis.fetch
    let calls = 0
    mockFetch(() => {
      calls++
      return Response.json({})
    })
    try {
      expect(await pickLabelIcon('   ', CANDIDATES, CONFIG)).toEqual({ ok: false, reason: 'empty' })
      expect(calls).toBe(0)
    }
    finally {
      globalThis.fetch = realFetch
    }
  })

  test('the request lands and its answer parses', async () => {
    const realFetch = globalThis.fetch
    const sent: { url?: string, init?: RequestInit } = {}
    mockFetch((input, init) => {
      sent.url = String(input)
      sent.init = init ?? {}
      return Response.json(JEV_RESPONSE_FIXTURE)
    })
    try {
      expect(await pickLabelIcon('生日蛋糕', CANDIDATES, CONFIG))
        .toEqual({ ok: true, pick: { icon: 'cake', confidence: 0.96 } })
      expect(sent.url).toBe('https://api.typesafe.ai/v1/systemone')
      expect(JSON.parse(String(sent.init?.body)).state).toBe('生日蛋糕')
    }
    finally {
      globalThis.fetch = realFetch
    }
  })

  test('a network failure is reported, not thrown', async () => {
    const realFetch = globalThis.fetch
    mockFetch(() => Promise.reject(new Error('offline')))
    try {
      expect(await pickLabelIcon('生日蛋糕', CANDIDATES, CONFIG)).toEqual({ ok: false, reason: 'network' })
    }
    finally {
      globalThis.fetch = realFetch
    }
  })

  test('the timeout is twenty seconds', () => {
    expect(JEV_TIMEOUT_MS).toBe(20_000)
  })
})
