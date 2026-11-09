/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { EMPTY_LIBRARY_SELECTION, librarySelectionTransition, selectedInOrder } from './librarySelection'

const order = ['a', 'b', 'c', 'd', 'e']
function pick(state = EMPTY_LIBRARY_SELECTION, id = 'a', mods: { toggle?: boolean, range?: boolean } = {}) {
  return librarySelectionTransition(state, { type: 'pick', id, order, mods: { toggle: false, range: false, ...mods } })
}

describe('librarySelectionTransition', () => {
  test('a plain pick clears the batch', () => {
    expect(pick(pick(EMPTY_LIBRARY_SELECTION, 'a', { toggle: true }), 'c').ids).toEqual([])
  })

  test('toggles append in click order and can remove', () => {
    const a = pick(EMPTY_LIBRARY_SELECTION, 'd', { toggle: true })
    const b = pick(a, 'b', { toggle: true })
    expect(b.ids).toEqual(['d', 'b'])
    expect(b.anchor).toBe('b')
    expect(pick(b, 'd', { toggle: true }).ids).toEqual(['b'])
  })

  test('a shift range replaces the batch with the slice between anchor and click', () => {
    let s = pick(EMPTY_LIBRARY_SELECTION, 'b', { toggle: true })
    s = pick(s, 'd', { range: true })
    expect(s.ids).toEqual(['b', 'c', 'd'])
    // The anchor stays on b, so the next range measures from there.
    s = pick(s, 'a', { range: true })
    expect(s.ids).toEqual(['a', 'b'])
  })

  test('a range with no live anchor selects just the clicked id', () => {
    const s = librarySelectionTransition(
      { ids: ['gone'], anchor: 'gone' },
      { type: 'pick', id: 'c', order, mods: { toggle: false, range: true } },
    )
    expect(s.ids).toEqual(['c'])
  })

  test('an id no longer in the list is refused', () => {
    const s = pick(EMPTY_LIBRARY_SELECTION, 'z', { toggle: true })
    expect(s).toBe(EMPTY_LIBRARY_SELECTION)
  })

  test('clear is idempotent', () => {
    const once = librarySelectionTransition(EMPTY_LIBRARY_SELECTION, { type: 'clear' })
    expect(once).toBe(EMPTY_LIBRARY_SELECTION)
    const picked = pick(EMPTY_LIBRARY_SELECTION, 'a', { toggle: true })
    expect(librarySelectionTransition(picked, { type: 'clear' })).toEqual(EMPTY_LIBRARY_SELECTION)
  })

  test('selectedInOrder drops ids the library no longer shows', () => {
    expect(selectedInOrder({ ids: ['c', 'gone', 'a'], anchor: 'a' }, order)).toEqual(['c', 'a'])
  })
})
