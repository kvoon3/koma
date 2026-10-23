/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { FALLBACK_TAG_ICON, TAG_ICON_NODES, tagIcon } from './tagIcons'

describe('a tag name earns a fitting icon', () => {
  test.each([
    ['party', 'celebration'],
    ['生日', 'celebration'],
    ['family', 'family'],
    ['全家', 'family'],
    ['portrait', 'person'],
    ['人物', 'person'],
    ['pizza', 'food'],
    ['美食', 'food'],
    ['coffee', 'drink'],
    ['咖啡', 'drink'],
    ['cat', 'cat'],
    ['猫', 'cat'],
    ['dog', 'dog'],
    ['狗', 'dog'],
    ['pet', 'pet'],
    ['宠物', 'pet'],
    ['beach', 'beach'],
    ['沙滩', 'beach'],
    ['mountain', 'mountain'],
    ['登山', 'mountain'],
    ['forest', 'nature'],
    ['森林', 'nature'],
    ['city', 'city'],
    ['城市', 'city'],
    ['car', 'car'],
    ['汽车', 'car'],
    ['plane', 'plane'],
    ['飞机', 'plane'],
    ['painting', 'art'],
    ['艺术', 'art'],
    ['night', 'night'],
    ['夜晚', 'night'],
    ['snow', 'snow'],
    ['雪', 'snow'],
  ] as const)('%s → %s', (name, key) => {
    expect(tagIcon(name)).toBe(key)
  })

  test('case never changes the answer', () => {
    expect(tagIcon('PERSON')).toBe('person')
    expect(tagIcon('Beach')).toBe('beach')
    expect(tagIcon('SNOW DAY')).toBe('snow')
  })

  test('the specific rule wins over the broad one', () => {
    expect(tagIcon('birthday cake')).toBe('celebration')
    expect(tagIcon('family portrait')).toBe('family')
    expect(tagIcon('hot dog')).toBe('food')
  })

  test('a word boundary stops a short keyword from firing inside a word', () => {
    expect(tagIcon('steak')).toBe('tag')
    expect(tagIcon('apartment')).toBe('city')
    expect(tagIcon('cats')).toBe('cat')
    expect(tagIcon('drinks')).toBe('drink')
  })

  test('an unmatched or empty name gets the neutral mark', () => {
    expect(tagIcon('mystery')).toBe(FALLBACK_TAG_ICON)
    expect(tagIcon('')).toBe('tag')
    expect(TAG_ICON_NODES[FALLBACK_TAG_ICON]).toBeDefined()
  })

  test('every key has a glyph, so no rule can point at nothing', () => {
    for (const [key, node] of Object.entries(TAG_ICON_NODES))
      expect({ key, drawn: Array.isArray(node) }).toEqual({ key, drawn: true })
  })
})
