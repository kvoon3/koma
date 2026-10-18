/// <reference types="bun" />
import type { Photo } from './imageStore'
import { describe, expect, test } from 'bun:test'
import { MAX_NAME_LEN } from './assetNames'
import {
  addTag,
  deleteTag,
  hasTag,
  isUntagged,
  MAX_TAG_NAME,
  normalizeTagList,
  renameTag,
  resolveTag,
  retag,
  setTags,
  tagCounts,
  tagsOf,
  untagAll,
  withoutTag,
  withTag,
} from './photoTags'
import { referenceCounts } from './stickerLibrary'

function photo(id: string, tags?: string[]): Photo {
  return {
    id,
    name: `${id}.jpg`,
    file: new File([], `${id}.jpg`, { type: 'image/jpeg' }),
    trueW: 100,
    trueH: 100,
    tags,
  }
}

describe('a photo\'s own tags', () => {
  test('absent tags read as none, and an untagged photo is the chip bar\'s bucket', () => {
    expect(tagsOf(photo('a'))).toEqual([])
    expect(isUntagged(photo('a'))).toBe(true)
    expect(isUntagged(photo('b', ['trip']))).toBe(false)
  })

  test('attaching cleans the name and leaves an untagged photo bare', () => {
    const one = withTag(photo('a'), '  Trip   Day 1 ')
    expect(one.tags).toEqual(['Trip Day 1'])
    // The normalized-away empty array: an untagged photo is not `tags: []`.
    expect(withTag(photo('a'), '   ').tags).toBeUndefined()
  })

  test('attaching twice in another case is one tag, and the first spelling wins', () => {
    const once = withTag(photo('a'), 'Trip')
    expect(withTag(once, ' trip ').tags).toEqual(['Trip'])
    expect(hasTag(once, 'TRIP')).toBe(true)
  })

  test('detaching one tag keeps the others; a tag it never had changes nothing', () => {
    const p = photo('a', ['trip', 'food'])
    expect(withoutTag(p, 'TRIP').tags).toEqual(['food'])
    expect(withoutTag(p, 'nope')).toBe(p)
    // The last one off leaves the field absent again.
    expect(withoutTag(photo('a', ['trip']), 'trip').tags).toBeUndefined()
  })

  test('setting the whole list dedupes and drops blanks', () => {
    expect(setTags(photo('a'), ['x', ' X ', '', 'y']).tags).toEqual(['x', 'y'])
    expect(setTags(photo('a', ['old']), []).tags).toBeUndefined()
  })
})

describe('the tag list (create / rename / delete)', () => {
  test('creating: blank is refused, spaces collapse, duplicates are case-insensitive', () => {
    expect(addTag([], '  ')).toEqual({ ok: false, reason: 'empty' })
    expect(addTag([], '  Day   Trip ')).toEqual({ ok: true, tags: ['Day Trip'], name: 'Day Trip' })
    expect(addTag(['Trip'], 'trip')).toEqual({ ok: false, reason: 'duplicate' })
    expect(addTag(['Trip'], ' TRIP ')).toEqual({ ok: false, reason: 'duplicate' })
  })

  test('creating: the name is capped without leaving a trailing space', () => {
    const long = addTag([], `${'x'.repeat(MAX_TAG_NAME)}   tail`)
    expect(long.ok && long.name).toBe('x'.repeat(MAX_TAG_NAME))
    const spaced = addTag([], `${'y'.repeat(MAX_TAG_NAME)} tail`)
    expect(spaced.ok && spaced.name).toBe('y'.repeat(MAX_TAG_NAME))
    expect(spaced.ok && spaced.name.endsWith(' ')).toBe(false)
    // Tags and folders share the one cap (see lib/assetNames).
    expect(MAX_TAG_NAME).toBe(MAX_NAME_LEN)
  })

  test('renaming: missing, blank and taken names are refused', () => {
    expect(renameTag(['Trip'], 'Nope', 'x')).toEqual({ ok: false, reason: 'missing' })
    expect(renameTag(['Trip'], 'Trip', '  ')).toEqual({ ok: false, reason: 'empty' })
    expect(renameTag(['Trip', 'Food'], 'Trip', 'food')).toEqual({ ok: false, reason: 'duplicate' })
  })

  test('renaming to its own name in another case is a rename, not a duplicate', () => {
    expect(renameTag(['Trip', 'Food'], 'Trip', 'trip'))
      .toEqual({ ok: true, tags: ['trip', 'Food'], name: 'trip' })
  })

  test('deleting drops only that tag; an unknown name changes nothing', () => {
    expect(deleteTag(['Trip', 'Food'], 'Trip')).toEqual(['Food'])
    expect(deleteTag(['Trip'], 'Nope')).toEqual(['Trip'])
  })

  test('a typed name resolves to an existing tag\'s own spelling', () => {
    expect(resolveTag(['Trip', 'Food'], ' trip ')).toBe('Trip')
    expect(resolveTag(['Trip'], 'New One')).toBe('New One')
    expect(resolveTag([], '   ')).toBeNull()
  })
})

describe('membership fan-out', () => {
  const photos = [photo('a', ['Trip', 'Food']), photo('b', ['food']), photo('c')]

  test('a rename repoints every photo wearing the tag, in any case', () => {
    const out = retag(photos, 'Trip', 'Journey')
    expect(out[0].tags).toEqual(['Journey', 'Food'])
    expect(out[1]).toBe(photos[1]!)
    expect(out[2]).toBe(photos[2]!)
  })

  test('a delete takes the tag off every photo and nothing else', () => {
    const out = untagAll(photos, 'food')
    expect(out[0].tags).toEqual(['Trip'])
    expect(out[1].tags).toBeUndefined()
    expect(out[2]).toBe(photos[2]!)
  })

  test('per-tag counts are over the photos passed in', () => {
    expect([...tagCounts(photos)]).toEqual([['Trip', 1], ['Food', 1], ['food', 1]])
    expect(tagCounts([]).size).toBe(0)
  })
})

describe('hydration of a session without tags', () => {
  test('a legacy session (no list, no photo tags) hydrates to no tags', () => {
    expect(normalizeTagList([], [photo('a'), photo('b')])).toEqual([])
  })

  test('the saved list keeps its order and its empty tags', () => {
    expect(normalizeTagList(['Trip', 'Food'], [photo('a')])).toEqual(['Trip', 'Food'])
  })

  test('a tag a photo still wears but the list lost is unioned back in', () => {
    expect(normalizeTagList(['Trip'], [photo('a', ['Trip', 'Food']), photo('b', ['trip'])])).toEqual(['Trip', 'Food'])
  })

  test('the union is cleaned and deduped case-insensitively', () => {
    expect(normalizeTagList(['  Trip ', 'trip'], [photo('a', ['FOOD', 'food']), photo('b', [' x '])]))
      .toEqual(['Trip', 'FOOD', 'x'])
  })
})

describe('usage derivation is the boards\' own, shared with the sticker page', () => {
  test('a photo drawn in a pane and as the collage background counts twice', () => {
    const leaf = { type: 'leaf' as const, id: 'p1', photoId: 'a', zoom: 1, cx: 0.5, cy: 0.5, stickers: [], label: null }
    const board = { id: 'w1', root: leaf, focusId: 'p1', canvasRatio: null, canvasFill: 1, stickers: [], labels: [] }
    const counts = referenceCounts([board], ['a'])
    expect(counts.get('a')).toBe(2)
    // Tagging has no bearing on it: usage is derived from the boards, never
    // stored, so it is the same function for both library pages.
    expect(tagCounts([photo('a', ['Trip'])])).toEqual(new Map([['Trip', 1]]))
  })
})
