/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { JEV_CATEGORIES, JEV_CATEGORY_IDS } from './jevTaxonomy'
import { TAG_ICON_NODES } from './tagIcons'

const ICON_KEYS: string[] = Object.keys(TAG_ICON_NODES).filter(key => key !== 'tag')

describe('the taxonomy is the icon set', () => {
  test('every non-fallback icon key is one category, in the same order', () => {
    expect([...JEV_CATEGORY_IDS] as string[]).toEqual(ICON_KEYS)
    expect(JEV_CATEGORIES.map(category => category.id) as string[]).toEqual(ICON_KEYS)
  })

  test('the categories are the seventeen subjects the tag icons know', () => {
    expect([...JEV_CATEGORY_IDS]).toEqual([
      'person',
      'family',
      'cat',
      'dog',
      'pet',
      'food',
      'drink',
      'nature',
      'beach',
      'mountain',
      'city',
      'car',
      'plane',
      'art',
      'night',
      'snow',
      'celebration',
    ])
  })

  test('a label is the capitalized id, so the chip and the question agree', () => {
    for (const category of JEV_CATEGORIES)
      expect(category.label).toBe(category.id.charAt(0).toUpperCase() + category.id.slice(1))
  })
})

describe('each category carries one usable judgment', () => {
  test('an instruction and both criteria are present and telling', () => {
    for (const category of JEV_CATEGORIES) {
      expect(category.instruction.trim().length).toBeGreaterThan(0)
      expect(category.criteria.true.trim().length).toBeGreaterThan(0)
      expect(category.criteria.false.trim().length).toBeGreaterThan(0)
      expect(category.criteria.true).not.toBe(category.criteria.false)
    }
  })
})
