/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  buildJevRequest,
  cleanJevLabels,
  JEV_IMAGE_HEADER,
  JEV_IMAGE_PART,
  JEV_LONG_EDGE,
  JEV_MAX_PIXELS,
  JEV_MIN_PIXELS,
  JEV_NOUL_THRESHOLD,
  JEV_PROXY_PATH,
  JEV_REQUEST_PART,
  JEV_RESPONSE_FIXTURE,
  JEV_SHORT_EDGE,
  JEV_SIDE_LIMIT,
  JEV_TIMEOUT_MS,
  jevImageBox,
  MAX_JEV_LABELS,
  parseJevResponse,
  readJevConfig,
} from './jev'
import { JEV_CATEGORIES, JEV_CATEGORY_IDS } from './jevTaxonomy'
import { MAX_TAG_NAME } from './photoTags'

describe('the endpoint is configured or hidden', () => {
  test('an absent, blank or malformed URL disables the action', () => {
    expect(readJevConfig({})).toBeNull()
    expect(readJevConfig({ VITE_JEV_API_URL: '   ' })).toBeNull()
    expect(readJevConfig({ VITE_JEV_API_URL: 'not a url' })).toBeNull()
    expect(readJevConfig({ VITE_JEV_API_URL: 'ftp://jev.example/classify' })).toBeNull()
  })

  test('an http(s) URL is kept, trimmed, with an optional trimmed key', () => {
    const trimmed = readJevConfig({ VITE_JEV_API_URL: ' https://jev.example/classify ' })
    expect(trimmed?.url.toString()).toBe('https://jev.example/classify')
    expect(trimmed?.key).toBeNull()

    const keyed = readJevConfig({
      VITE_JEV_API_URL: 'https://jev.example/classify',
      VITE_JEV_API_KEY: '  s3cret  ',
    })
    expect(keyed?.url.toString()).toBe('https://jev.example/classify')
    expect(keyed?.key).toBe('s3cret')

    const blankKey = readJevConfig({
      VITE_JEV_API_URL: 'http://127.0.0.1:4319/classify',
      VITE_JEV_API_KEY: '   ',
    })
    expect(blankKey?.url.toString()).toBe('http://127.0.0.1:4319/classify')
    expect(blankKey?.key).toBeNull()
  })

  test('a relative path resolves against the page, protocol-relative is refused', () => {
    const relative = readJevConfig({ VITE_JEV_API_URL: ' /api/jev ' })
    expect(relative?.url.pathname).toBe('/api/jev')
    expect(relative?.url.origin).toBe('http://localhost')
    expect(readJevConfig({ VITE_JEV_API_URL: '//evil.example/api/jev' })).toBeNull()
  })

  test('a relative path stays on http, so a file page hides the action', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', { value: { origin: 'file://' }, configurable: true })
    try {
      expect(readJevConfig({ VITE_JEV_API_URL: '/api/jev' })).toBeNull()
    }
    finally {
      if (original)
        Object.defineProperty(globalThis, 'location', original)
      else
        delete (globalThis as { location?: unknown }).location
    }
  })

  test('a production build falls back to the same-origin proxy', () => {
    const fallback = readJevConfig({ PROD: true })
    expect(fallback?.url.pathname).toBe(JEV_PROXY_PATH)
    expect(fallback?.url.origin).toBe('http://localhost')
    expect(fallback?.key).toBeNull()

    expect(readJevConfig({ PROD: false })).toBeNull()
  })

  test('an explicit URL still wins in a production build', () => {
    const explicit = readJevConfig({ PROD: true, VITE_JEV_API_URL: 'https://mock.example/classify' })
    expect(explicit?.url.toString()).toBe('https://mock.example/classify')
  })

  test('production drops the local key, so the bundle never needs one', () => {
    const prod = readJevConfig({
      PROD: true,
      VITE_JEV_API_URL: 'https://mock.example/classify',
      VITE_JEV_API_KEY: ' s3cret ',
    })
    expect(prod?.key).toBeNull()

    const dev = readJevConfig({
      PROD: false,
      VITE_JEV_API_URL: '/api/jev',
      VITE_JEV_API_KEY: ' s3cret ',
    })
    expect(dev?.key).toBe('s3cret')
  })
})

describe('the request carries one Noul per category', () => {
  const config = { url: new URL('https://api.typesafe.ai/v1/systemone'), key: null }

  async function documentOf(image: Blob, key: string | null = null) {
    const { init } = buildJevRequest(image, { ...config, key })
    const form = init.body as FormData
    const request = form.get(JEV_REQUEST_PART) as Blob
    return {
      form,
      requestType: request.type,
      document: JSON.parse(await request.text()),
      headers: init.headers as Record<string, string>,
    }
  }

  test('the JSON part names the model, the asset and the photo state', async () => {
    const { requestType, document } = await documentOf(new Blob(['jpeg'], { type: 'image/jpeg' }))
    expect(requestType.startsWith('application/json')).toBe(true)
    expect(document.model).toBe('jev-latest')
    expect(document.state).toEqual({ photo: 'photo' })
    expect(document.assets).toEqual({ photo: { type: 'image', part: JEV_IMAGE_PART } })
  })

  test('the questions are the taxonomy, keyed by the icon ids', async () => {
    const { document } = await documentOf(new Blob(['jpeg']))
    expect(Object.keys(document.questions)).toEqual([...JEV_CATEGORY_IDS])
    for (const category of JEV_CATEGORIES) {
      expect(document.questions[category.id]).toEqual({
        type: 'noul',
        instructions: category.instruction,
        criteria: { true: category.criteria.true, false: category.criteria.false },
      })
    }
  })

  test('the prepared image travels as its own JPEG part', async () => {
    const { form } = await documentOf(new Blob(['pixels'], { type: 'image/jpeg' }))
    const part = form.get(JEV_IMAGE_PART) as File
    expect(part).toBeInstanceOf(Blob)
    expect(part.name).toBe('photo.jpg')
    expect(await part.text()).toBe('pixels')
  })

  test('the image header rides always, the bearer only with a key', async () => {
    const plain = await documentOf(new Blob(['x']))
    expect(plain.headers[JEV_IMAGE_HEADER]).toBe('true')
    expect(plain.headers.Accept).toBe('application/json')
    expect(plain.headers.Authorization).toBeUndefined()

    const keyed = await documentOf(new Blob(['x']), 's3cret')
    expect(keyed.headers.Authorization).toBe('Bearer s3cret')
  })
})

describe('the image box stays inside the API limits', () => {
  test.each([
    [4000, 3000, 1024, 768],
    [3000, 4000, 768, 1024],
    [4000, 4000, 1024, 1024],
    [2000, 1000, 1024, 512],
    [1000, 300, 1000, 300],
    [280, 280, 280, 280],
  ] as const)('%d x %d becomes %d x %d', (w, h, width, height) => {
    expect(jevImageBox(w, h)).toEqual({ width, height })
  })

  test('a panorama is letterboxed, not upscaled past the long edge', () => {
    expect(jevImageBox(4000, 500)).toEqual({ width: 1024, height: 280 })
    expect(jevImageBox(500, 4000)).toEqual({ width: 280, height: 1024 })
  })

  test('a tiny image grows only as far as the short edge needs', () => {
    expect(jevImageBox(100, 100)).toEqual({ width: 280, height: 280 })
    expect(jevImageBox(100, 20)).toEqual({ width: 1024, height: 280 })
  })

  test('a degenerate size still returns a legal box', () => {
    expect(jevImageBox(0, 0)).toEqual({ width: 280, height: 280 })
    expect(jevImageBox(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ width: 280, height: 280 })
  })

  test('every reasonable source lands inside both side and pixel limits', () => {
    for (let w = 1; w <= 5000; w += 137) {
      for (let h = 1; h <= 5000; h += 211) {
        const box = jevImageBox(w, h)
        const sides = [box.width, box.height]
        expect(Math.min(...sides)).toBeGreaterThanOrEqual(JEV_SHORT_EDGE)
        expect(Math.max(...sides)).toBeLessThanOrEqual(JEV_LONG_EDGE)
        expect(Math.max(...sides)).toBeLessThanOrEqual(JEV_SIDE_LIMIT)
        expect(box.width * box.height).toBeGreaterThanOrEqual(JEV_MIN_PIXELS)
        expect(box.width * box.height).toBeLessThanOrEqual(JEV_MAX_PIXELS)
      }
    }
  })
})

describe('the response parser reads only Noul answers', () => {
  test('the fixture keeps the labels at or above the threshold, highest first', () => {
    expect(JEV_NOUL_THRESHOLD).toBe(0.7)
    expect(parseJevResponse(200, JSON.stringify(JEV_RESPONSE_FIXTURE)))
      .toEqual({ ok: true, labels: ['Person', 'Beach'] })
  })

  test('the threshold is inclusive and labels sort by probability', () => {
    const body = JSON.stringify({
      model: 'jev-1.14.0',
      answers: {
        cat: { type: 'noul', noul: 0.75 },
        person: { type: 'noul', noul: 0.7 },
        beach: { type: 'noul', noul: 0.8 },
        food: { type: 'noul', noul: 0.699 },
      },
    })
    expect(parseJevResponse(200, body)).toEqual({ ok: true, labels: ['Beach', 'Cat', 'Person'] })
  })

  test('the cap keeps the highest eight', () => {
    const answers = Object.fromEntries(JEV_CATEGORY_IDS.map((id, index) => [id, {
      type: 'noul',
      noul: 0.9 - index * 0.01,
    }]))
    const result = parseJevResponse(200, JSON.stringify({ answers }))
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.labels).toHaveLength(MAX_JEV_LABELS)
  })

  test('unknown ids are ignored, and an answer with none of ours is empty', () => {
    expect(parseJevResponse(200, JSON.stringify({
      answers: { alien: { type: 'noul', noul: 0.99 }, person: { type: 'noul', noul: 0.1 } },
    }))).toEqual({ ok: false, reason: 'empty' })
  })

  test('nothing over the threshold is empty, not a shape fault', () => {
    expect(parseJevResponse(200, JSON.stringify({
      answers: { person: { type: 'noul', noul: 0.2 } },
    }))).toEqual({ ok: false, reason: 'empty' })
  })

  test('the boundary failures stay distinct', () => {
    expect(parseJevResponse(401, '{"answers":{}}')).toEqual({ ok: false, reason: 'http', status: 401 })
    expect(parseJevResponse(500, '<html>oops</html>')).toEqual({ ok: false, reason: 'http', status: 500 })
    expect(parseJevResponse(200, 'not json')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseJevResponse(200, '')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseJevResponse(200, 'null')).toEqual({ ok: false, reason: 'shape' })
    expect(parseJevResponse(200, '[]')).toEqual({ ok: false, reason: 'shape' })
    expect(parseJevResponse(200, '{}')).toEqual({ ok: false, reason: 'shape' })
    expect(parseJevResponse(200, '{"answers":[]}')).toEqual({ ok: false, reason: 'shape' })
  })

  test('a known id with the wrong Noul shape is a shape fault', () => {
    const cases = [
      { person: { type: 'choice', noul: 0.9 } },
      { person: { type: 'noul' } },
      { person: { type: 'noul', noul: 'high' } },
      { person: { type: 'noul', noul: null } },
      { person: { type: 'noul', noul: 1.01 } },
      { person: { type: 'noul', noul: -0.01 } },
      { person: 'yes' },
    ]
    for (const answers of cases)
      expect(parseJevResponse(200, JSON.stringify({ answers }))).toEqual({ ok: false, reason: 'shape' })
  })

  test('extra fields and a concrete model are ignored', () => {
    expect(parseJevResponse(201, JSON.stringify({
      model: 'jev-1.14.0',
      answers: { beach: { type: 'noul', noul: 0.9, extra: true } },
      usage: { input_tokens: 1, output_tokens: 1 },
    }))).toEqual({ ok: true, labels: ['Beach'] })
  })
})

describe('answer labels follow the tag rules', () => {
  test('spaces collapse, blanks drop, and one name keeps its first spelling', () => {
    expect(cleanJevLabels(['  Day   Trip ', 'day trip', '', 'Food']))
      .toEqual(['Day Trip', 'Food'])
  })

  test('the name cap is the tag cap', () => {
    const [name] = cleanJevLabels([`${'x'.repeat(MAX_TAG_NAME)}   tail`])
    expect(name).toBe('x'.repeat(MAX_TAG_NAME))
  })

  test('the count cap keeps an answer to one chip row', () => {
    const many = Array.from({ length: MAX_JEV_LABELS + 6 }, (_, i) => `tag ${i}`)
    expect(cleanJevLabels(many)).toHaveLength(MAX_JEV_LABELS)
  })
})

describe('the request has one timeout for the whole call', () => {
  test('the timeout is twenty seconds', () => {
    expect(JEV_TIMEOUT_MS).toBe(20_000)
  })
})
