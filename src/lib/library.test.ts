/// <reference types="bun" />
import type { Photo } from './imageStore'
import { describe, expect, test } from 'bun:test'
import {
  LIBRARY_KINDS,
  libraryAssets,
  libraryCounts,
  libraryTotal,
  livePick,
  matchesQuery,
  normalizeQuery,
  parseLibraryType,
  validGroup,
} from './library'
import { ja } from './locales/ja'
import { zhHans } from './locales/zh-Hans'
import { zhHant } from './locales/zh-Hant'

function photo(id: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    name: `${id}.png`,
    file: new File([], `${id}.png`, { type: 'image/png' }),
    trueW: 100,
    trueH: 100,
    ...extra,
  }
}

const sticker = (id: string, extra: Partial<Photo> = {}) => photo(id, { kind: 'sticker', ...extra })

describe('the kinds that make the library', () => {
  test('assets split by the marker and drop orphaned snapshots', () => {
    const photos = [
      photo('p1'),
      sticker('s1'),
      photo('p2', { kind: 'photo' }),
      sticker('s2'),
      { ...sticker('retired'), orphaned: true },
      { ...photo('gone'), orphaned: true },
    ]
    const assets = libraryAssets(photos)
    expect(assets.photo.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(assets.sticker.map(p => p.id)).toEqual(['s1', 's2'])
  })

  test('counts and the total follow those lists', () => {
    const assets = libraryAssets([photo('p1'), sticker('s1'), sticker('s2')])
    const counts = libraryCounts(assets)
    expect(counts).toEqual({ photo: 1, sticker: 2 })
    expect(libraryTotal(counts)).toBe(3)
    expect(libraryTotal(libraryCounts(libraryAssets([])))).toBe(0)
  })

  test('every kind label is translated in all three dictionaries', () => {
    const dictionaries = [zhHans, zhHant, ja]
    for (const kind of LIBRARY_KINDS) {
      for (const dict of dictionaries)
        expect(dict[kind.label]).toBeTruthy()
    }
  })
})

describe('the type in the URL', () => {
  test('each kind parses back', () => {
    for (const kind of LIBRARY_KINDS)
      expect(parseLibraryType(kind.type)).toBe(kind.type)
  })

  test('anything else is no filter at all', () => {
    for (const raw of [undefined, null, 0, 3, ['photo'], 'all', 'music', '', 'Photo'])
      expect(parseLibraryType(raw)).toBeUndefined()
  })
})

describe('group picks', () => {
  test('null and "" stay, a live name stays, a vanished name falls back', () => {
    expect(validGroup(null, ['Faces'])).toBeNull()
    expect(validGroup('', ['Faces'])).toBe('')
    expect(validGroup('Faces', ['Faces', 'Animals'])).toBe('Faces')
    expect(validGroup('Cities', ['Faces', 'Animals'])).toBeNull()
  })

  test('a pick only applies while its kind is on screen', () => {
    expect(livePick('photo', 'photo', 'Faces')).toBe('Faces')
    expect(livePick('sticker', 'sticker', 'Faces')).toBe('Faces')
    expect(livePick('photo', 'sticker', 'Faces')).toBeNull()
    expect(livePick('sticker', 'photo', 'Faces')).toBeNull()
    expect(livePick('all', 'photo', 'Faces')).toBeNull()
    expect(livePick('all', 'sticker', '')).toBeNull()
  })
})

describe('the search field', () => {
  test('matching is case-insensitive and ignores surrounding space', () => {
    const p = photo('beach', { name: 'Sunset Beach.PNG' })
    expect(matchesQuery(p, normalizeQuery('  sunset '))).toBe(true)
    expect(matchesQuery(p, normalizeQuery('BEACH'))).toBe(true)
    expect(matchesQuery(p, normalizeQuery('mountain'))).toBe(false)
  })

  test('an empty query matches everything', () => {
    const p = photo('p1')
    expect(matchesQuery(p, normalizeQuery(''))).toBe(true)
    expect(matchesQuery(p, normalizeQuery('   '))).toBe(true)
  })
})
