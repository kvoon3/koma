/// <reference types="bun" />
import { beforeEach, describe, expect, test } from 'bun:test'
import { formatSeen, hubKeyForPath, markHubSeen, readHubSeen } from './hubSeen'

/** An in-memory stand-in: bun test has no localStorage. */
const saved = new Map<string, string>()
const storage = {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => void saved.set(k, v),
  removeItem: (k: string) => void saved.delete(k),
  clear: () => saved.clear(),
}

describe('which destination a route belongs to', () => {
  test('the board overview (the app root) and every editor board are grid making', () => {
    expect(hubKeyForPath('/')).toBe('grid')
    expect(hubKeyForPath('/w/w-1')).toBe('grid')
  })

  test('the two library pages are their own entries, the retained launcher is none', () => {
    expect(hubKeyForPath('/photos')).toBe('photos')
    expect(hubKeyForPath('/stickers')).toBe('stickers')
    expect(hubKeyForPath('/legacy-index')).toBeNull()
  })
})

describe('the visit log', () => {
  beforeEach(() => {
    storage.clear()
    Object.assign(globalThis, { localStorage: storage })
  })

  test('a fresh install has nothing to say', () => {
    expect(readHubSeen()).toEqual({})
  })

  test('marking one destination keeps the others', () => {
    markHubSeen('grid', 1_700_000_000_000)
    markHubSeen('photos', 1_700_000_600_000)
    expect(readHubSeen()).toEqual({ grid: 1_700_000_000_000, photos: 1_700_000_600_000 })
  })

  test('garbage in storage reads as no visits, and never throws', () => {
    storage.setItem('collage:hubSeen', 'not json')
    expect(readHubSeen()).toEqual({})
    storage.setItem('collage:hubSeen', JSON.stringify({ grid: 'soon', photos: -1, stickers: 12 }))
    expect(readHubSeen()).toEqual({ stickers: 12 })
  })
})

describe('how a visit reads', () => {
  const now = new Date(2026, 9, 18, 21, 5).getTime()

  test('today shows the time, another day carries the date', () => {
    expect(formatSeen(new Date(2026, 9, 18, 19, 15).getTime(), now)).toBe('19:15')
    expect(formatSeen(new Date(2026, 9, 17, 8, 4).getTime(), now)).toBe('10-17 08:04')
    expect(formatSeen(new Date(2025, 0, 2, 23, 59).getTime(), now)).toBe('01-02 23:59')
  })

  test('never opened is null, not a zero date', () => {
    expect(formatSeen(undefined, now)).toBeNull()
    expect(formatSeen(0, now)).toBeNull()
    expect(formatSeen(Number.NaN, now)).toBeNull()
  })
})
