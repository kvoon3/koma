import { describe, expect, test } from 'bun:test'
import { cellMoves, moveAt, slotPoint } from './gridShuffle'

const geo = { cell: 100, cellH: 120, gap: 10 }
const w = (id: string) => ({ id })

describe('slotPoint', () => {
  test('lays three columns out with the gap', () => {
    expect(slotPoint(0, geo)).toEqual({ x: 0, y: 0 })
    expect(slotPoint(2, geo)).toEqual({ x: 220, y: 0 })
    expect(slotPoint(4, geo)).toEqual({ x: 110, y: 130 })
  })
})

describe('cellMoves', () => {
  test('a swap gives each cell the other slot', () => {
    const moves = cellMoves([w('a'), w('b'), w('c'), w('d')], [w('b'), w('a'), w('c'), w('d')], geo)
    expect(moves).toEqual([
      { id: 'b', from: { x: 110, y: 0 }, to: { x: 0, y: 0 } },
      { id: 'a', from: { x: 0, y: 0 }, to: { x: 110, y: 0 } },
    ])
  })

  test('identities produce no move', () => {
    expect(cellMoves([w('a'), w('x'), w('c')], [w('a'), w('x'), w('c')], geo)).toEqual([])
  })

  test('new and removed ids are skipped', () => {
    expect(cellMoves([w('a'), w('b')], [w('c'), w('a')], geo)).toEqual([
      { id: 'a', from: { x: 0, y: 0 }, to: { x: 110, y: 0 } },
    ])
  })
})

describe('moveAt', () => {
  test('interpolates from the start to the end', () => {
    const move = { id: 'a', from: { x: 0, y: 0 }, to: { x: 100, y: 50 } }
    expect(moveAt(move, 0)).toEqual({ x: 0, y: 0 })
    expect(moveAt(move, 1)).toEqual({ x: 100, y: 50 })
    expect(moveAt(move, 0.5)).toEqual({ x: 50, y: 25 })
  })
})
