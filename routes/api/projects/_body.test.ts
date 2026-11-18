/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DOCUMENT_MAX_BYTES, NAME_MAX_CHARS, parseCreateBody, parseJsonBody, parseUpdateBody, writeBodyFailure } from './_body'

const document = '{"version":1}'

describe('parseJsonBody', () => {
  test('malformed JSON is a refusal, not a throw', () => {
    expect(parseJsonBody('{').ok).toBe(false)
    expect(parseJsonBody('').ok).toBe(false)
    expect(parseJsonBody('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })
})

describe('parseCreateBody', () => {
  test('accepts a named document and refuses a missing or blank name', () => {
    expect(parseCreateBody({ name: 'Board', document })).toEqual({ ok: true, value: { name: 'Board', document } })
    expect(parseCreateBody({ document })).toEqual({ ok: false, error: 'invalid-name' })
    expect(parseCreateBody({ name: '   ', document })).toEqual({ ok: false, error: 'invalid-name' })
    expect(parseCreateBody({ name: 7, document })).toEqual({ ok: false, error: 'invalid-name' })
  })

  test(`the name cap is ${NAME_MAX_CHARS} characters`, () => {
    expect(parseCreateBody({ name: 'n'.repeat(NAME_MAX_CHARS), document }).ok).toBe(true)
    expect(parseCreateBody({ name: 'n'.repeat(NAME_MAX_CHARS + 1), document })).toEqual({ ok: false, error: 'invalid-name' })
  })

  test(`the document cap is ${DOCUMENT_MAX_BYTES} UTF-8 bytes`, () => {
    expect(parseCreateBody({ name: 'Board', document: 'x'.repeat(DOCUMENT_MAX_BYTES) }).ok).toBe(true)
    expect(parseCreateBody({ name: 'Board', document: 'x'.repeat(DOCUMENT_MAX_BYTES + 1) })).toEqual({ ok: false, error: 'document-too-large' })
    expect(parseCreateBody({ name: 'Board', document: 'é'.repeat(DOCUMENT_MAX_BYTES / 2 + 1) })).toEqual({ ok: false, error: 'document-too-large' })
  })

  test('a non-record or a non-string document is invalid', () => {
    expect(parseCreateBody(null)).toEqual({ ok: false, error: 'invalid' })
    expect(parseCreateBody({ name: 'Board', document: 7 })).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('parseUpdateBody', () => {
  const base = { document, updatedAt: '2026-11-18 10:00:00.000' }

  test('a name is optional, but a present invalid name is refused', () => {
    expect(parseUpdateBody(base)).toEqual({ ok: true, value: base })
    expect(parseUpdateBody({ ...base, name: 'Renamed' })).toEqual({ ok: true, value: { ...base, name: 'Renamed' } })
    expect(parseUpdateBody({ ...base, name: '' })).toEqual({ ok: false, error: 'invalid-name' })
    expect(parseUpdateBody({ ...base, name: 'n'.repeat(NAME_MAX_CHARS + 1) })).toEqual({ ok: false, error: 'invalid-name' })
  })

  test('the document and timestamp bounds are enforced', () => {
    expect(parseUpdateBody({ ...base, document: 'x'.repeat(DOCUMENT_MAX_BYTES + 1) })).toEqual({ ok: false, error: 'document-too-large' })
    expect(parseUpdateBody({ document, updatedAt: 7 })).toEqual({ ok: false, error: 'invalid' })
    expect(parseUpdateBody({ document })).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('writeBodyFailure', () => {
  test('an oversized document is 413 and everything else is 400', () => {
    expect(writeBodyFailure('document-too-large')).toEqual({ status: 413, body: { error: 'document-too-large' } })
    expect(writeBodyFailure('invalid-name')).toEqual({ status: 400, body: { error: 'invalid-name' } })
    expect(writeBodyFailure('invalid')).toEqual({ status: 400, body: { error: 'invalid-body' } })
  })
})
