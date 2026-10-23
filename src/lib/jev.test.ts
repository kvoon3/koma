/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  JEV_LABEL_ICON_INSTRUCTIONS,
  JEV_NONE_CHOICE,
  JEV_NONE_DESCRIPTION,
  JEV_PROXY_PATH,
  JEV_QUESTION_ID,
  JEV_TIMEOUT_MS,
  labelIconRequest,
  parseLabelIconResponse,
  pickLabelIcon,
  readJevConfig,
} from './jev'

const RESPONSE_FIXTURE = {
  model: 'jev-1.14.0',
  answers: { [JEV_QUESTION_ID]: { type: 'choice', choice: 'cake', confidence: 0.96 } },
  usage: { input_tokens: 220, output_tokens: 3 },
}

const CANDIDATES = [
  { id: 'cake', description: 'Cake' },
  { id: 'plane', description: 'Plane' },
] as const

const CONFIG = { url: new URL('https://api.typesafe.ai/v1/systemone'), key: null }

/** Run one check against a swapped global fetch, then restore it. */
async function withFetch<T>(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(input, init)) as typeof fetch
  try {
    return await run()
  }
  finally {
    globalThis.fetch = real
  }
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
})

describe('the bearer rides only when a key is set', () => {
  test('the key becomes a bearer and its absence sends none', async () => {
    const headersFor = async (key: string | null) => {
      const sent: { headers?: Record<string, string> } = {}
      await withFetch((_input, init) => {
        sent.headers = init?.headers as Record<string, string>
        return Response.json(RESPONSE_FIXTURE)
      }, () => pickLabelIcon('x', CANDIDATES, { ...CONFIG, key }))
      return sent.headers
    }
    expect((await headersFor(null))?.Authorization).toBeUndefined()
    expect((await headersFor('s3cret'))?.Authorization).toBe('Bearer s3cret')
  })
})

describe('the parser reads the Choice answer', () => {
  const ids = CANDIDATES.map(candidate => candidate.id)

  test('the fixture picks the named icon and keeps its confidence', () => {
    expect(parseLabelIconResponse(200, JSON.stringify(RESPONSE_FIXTURE), ids))
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
    let calls = 0
    await withFetch(() => {
      calls++
      return Response.json({})
    }, async () => {
      expect(await pickLabelIcon('   ', CANDIDATES, CONFIG)).toEqual({ ok: false, reason: 'empty' })
    })
    expect(calls).toBe(0)
  })

  test('the request lands with its own content type and no image header', async () => {
    const sent: { url?: string, init?: RequestInit } = {}
    await withFetch((input, init) => {
      sent.url = String(input)
      sent.init = init ?? {}
      return Response.json(RESPONSE_FIXTURE)
    }, async () => {
      expect(await pickLabelIcon('生日蛋糕', CANDIDATES, CONFIG))
        .toEqual({ ok: true, pick: { icon: 'cake', confidence: 0.96 } })
    })
    expect(sent.url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(sent.init?.method).toBe('POST')
    const headers = sent.init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Accept).toBe('application/json')
    expect(headers['TypeSafe-Danger-Zone-Images']).toBeUndefined()
    const body = JSON.parse(String(sent.init?.body))
    expect(body.state).toBe('生日蛋糕')
    expect(body.assets).toBeUndefined()
  })

  test('a network failure is reported, not thrown', async () => {
    await withFetch(() => Promise.reject(new Error('offline')), async () => {
      expect(await pickLabelIcon('生日蛋糕', CANDIDATES, CONFIG)).toEqual({ ok: false, reason: 'network' })
    })
  })

  test('the timeout is twenty seconds', () => {
    expect(JEV_TIMEOUT_MS).toBe(20_000)
  })
})
