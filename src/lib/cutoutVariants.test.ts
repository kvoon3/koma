/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { dropCutoutSetRefs, normalizeCutoutSets, pruneCutoutSets, recordBlurredSet, recordCutoutSet, variantsOf } from './cutoutVariants'

/**
 * The dock's Cut out menu reads all three states off the library, so the
 * asset graph is pure bookkeeping and is pinned here: what each photo is, what
 * the menu can offer, and what survives a library that lost an asset.
 */
const library = (...ids: string[]) => (id: string) => ids.includes(id)

describe('what a pane photo is', () => {
  const cutouts = { c1: 's1', b1: 's1' }
  const sets = { s1: { cutout: 'c1', blurred: 'b1' } }

  test('the source photo reads as original', () => {
    expect(variantsOf(cutouts, sets, 's1', library('s1', 'c1', 'b1'))).toEqual({ source: 's1', cutout: 'c1', blurred: 'b1', state: 'original' })
  })
  test('the cutout PNG reads as the transparent state', () => {
    expect(variantsOf(cutouts, sets, 'c1', library('s1', 'c1', 'b1')).state).toBe('cutout')
  })
  test('the composite reads as the blurred state', () => {
    expect(variantsOf(cutouts, sets, 'b1', library('s1', 'c1', 'b1')).state).toBe('blurred')
  })
  test('a photo nothing was cut from is its own source and original', () => {
    expect(variantsOf({}, {}, 'p1', library('p1'))).toEqual({ source: 'p1', cutout: null, blurred: null, state: 'original' })
  })
  test('an older save has no table: its cutout adopts itself as the row', () => {
    // A session from before the menu carries the map only.
    const v = variantsOf({ c1: 's1' }, {}, 'c1', library('s1', 'c1'))
    expect(v).toEqual({ source: 's1', cutout: 'c1', blurred: null, state: 'cutout' })
  })
})

describe('the menu when an asset is gone', () => {
  test('a source that left the library leaves Original unavailable', () => {
    // The pane still draws the orphaned cutout; nothing can go back to.
    const v = variantsOf({ c1: 's1' }, { s1: { cutout: 'c1' } }, 'c1', library('c1'))
    expect(v.source).toBeNull()
    expect(v.state).toBe('cutout')
  })
  test('a blurred composite that left is not offered, the cutout still is', () => {
    const v = variantsOf({ c1: 's1', b1: 's1' }, { s1: { cutout: 'c1', blurred: 'b1' } }, 's1', library('s1', 'c1'))
    expect(v.blurred).toBeNull()
    expect(v.cutout).toBe('c1')
  })
})

describe('recording', () => {
  test('a first cutout opens the row', () => {
    expect(recordCutoutSet({}, 's1', 'c1')).toEqual({ s1: { cutout: 'c1' } })
  })
  test('baking the composite fills the same row', () => {
    const sets = recordBlurredSet(recordCutoutSet({}, 's1', 'c1'), 's1', 'c1', 'b1')
    expect(sets).toEqual({ s1: { cutout: 'c1', blurred: 'b1' } })
  })
  test('a re-cut replaces the cutout and keeps the composite', () => {
    const sets = recordCutoutSet({ s1: { cutout: 'c1', blurred: 'b1' } }, 's1', 'c2')
    expect(sets.s1).toEqual({ cutout: 'c2', blurred: 'b1' })
  })
})

describe('hydration and deletion keep the table honest', () => {
  const sets = { s1: { cutout: 'c1', blurred: 'b1' }, s2: { cutout: 'c2' } }
  test('a hydrate drops rows whose photos are gone', () => {
    expect(pruneCutoutSets(sets, new Set(['s1', 'c1', 'b1', 's2']))).toEqual({ s1: { cutout: 'c1', blurred: 'b1' } })
    expect(pruneCutoutSets(sets, new Set(['s1', 'c1', 'b1']))).toEqual({ s1: { cutout: 'c1', blurred: 'b1' } })
    // A row with no cutout left has nothing to offer.
    expect(pruneCutoutSets({ s2: { cutout: 'c2' } }, new Set(['s2']))).toEqual({})
  })
  test('retiring a photo takes its row, or the reference to it', () => {
    expect(dropCutoutSetRefs(sets, 's2')).toEqual({ s1: { cutout: 'c1', blurred: 'b1' } })
    expect(dropCutoutSetRefs(sets, 'b1')).toEqual({ s1: { cutout: 'c1' }, s2: { cutout: 'c2' } })
    expect(dropCutoutSetRefs(sets, 'c1')).toEqual({ s2: { cutout: 'c2' } })
  })
  test('untrusted input is validated, not trusted', () => {
    expect(normalizeCutoutSets(null)).toEqual({})
    expect(normalizeCutoutSets('nope')).toEqual({})
    expect(normalizeCutoutSets({ 's1': { cutout: 'c1' }, 's2': { cutout: 42 }, 's3': {}, 's4': null, '': { cutout: 'x' } }))
      .toEqual({ s1: { cutout: 'c1' } })
    expect(normalizeCutoutSets({ s1: { cutout: 'c1', blurred: '' } })).toEqual({ s1: { cutout: 'c1' } })
  })
})
