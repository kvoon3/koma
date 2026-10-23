/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  buildJevRequest,
  cleanJevLabels,
  JEV_IMAGE_FIELD,
  JEV_RESPONSE_FIXTURE,
  MAX_JEV_LABELS,
  parseJevResponse,
  readJevConfig,
} from './jev'
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
})

describe('the request shape', () => {
  const config = { url: new URL('https://jev.example/classify'), key: null }

  test('one image travels under the assumed multipart field', async () => {
    const image = new Blob(['pixels'], { type: 'image/jpeg' })
    const { url, init } = buildJevRequest(image, config)
    expect(url).toBe(config.url.toString())
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    const part = form.get(JEV_IMAGE_FIELD) as File
    expect(part).toBeInstanceOf(Blob)
    expect(part.name).toBe('photo.jpg')
    expect(await part.text()).toBe('pixels')
  })

  test('a PNG keeps its extension, and no key means no Authorization header', () => {
    const { init } = buildJevRequest(new Blob(['x'], { type: 'image/png' }), config)
    expect((init.body as FormData).get(JEV_IMAGE_FIELD)).toBeInstanceOf(Blob)
    expect(((init.body as FormData).get(JEV_IMAGE_FIELD) as File).name).toBe('photo.png')
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  test('a key rides as a bearer token', () => {
    const { init } = buildJevRequest(new Blob(['x']), { ...config, key: 's3cret' })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer s3cret')
  })
})

describe('the response parser', () => {
  test('the fixture pins the assumed answer', () => {
    expect(parseJevResponse(200, JSON.stringify(JEV_RESPONSE_FIXTURE)))
      .toEqual({ ok: true, labels: ['person', 'beach', 'food'] })
  })

  test('the four boundary failures stay distinct', () => {
    expect(parseJevResponse(401, '{"labels":["person"]}')).toEqual({ ok: false, reason: 'http', status: 401 })
    expect(parseJevResponse(500, '<html>oops</html>')).toEqual({ ok: false, reason: 'http', status: 500 })
    expect(parseJevResponse(200, 'not json')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseJevResponse(200, '')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseJevResponse(200, 'null')).toEqual({ ok: false, reason: 'shape' })
    expect(parseJevResponse(200, '{}')).toEqual({ ok: false, reason: 'shape' })
    expect(parseJevResponse(200, '{"labels":"person"}')).toEqual({ ok: false, reason: 'shape' })
    expect(parseJevResponse(200, '{"labels":["person",3]}')).toEqual({ ok: false, reason: 'shape' })
    expect(parseJevResponse(200, '{"labels":[]}')).toEqual({ ok: false, reason: 'empty' })
    expect(parseJevResponse(200, '{"labels":["  ",""]}')).toEqual({ ok: false, reason: 'empty' })
  })

  test('extra fields are ignored and a 2xx carries the labels', () => {
    expect(parseJevResponse(201, '{"labels":["Person"],"confidence":[0.9]}'))
      .toEqual({ ok: true, labels: ['Person'] })
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
