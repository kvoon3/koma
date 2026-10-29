/// <reference types="bun" />
import type { DockBox } from './dockHighlight'
import { describe, expect, test } from 'bun:test'
import { DOCK_BOX_EPSILON, glideDelta, guardsOnly, hopDelta, isStill, sameRowBand } from './dockHighlight'

const box = (left: number, top: number, width = 80, height = 72): DockBox => ({ left, top, width, height })

describe('glideDelta', () => {
  test('is the painted box expressed against the target', () => {
    expect(glideDelta(box(120, 40), box(200, 40))).toEqual({ x: -80, y: 0 })
    expect(glideDelta(box(80, 100), box(80, 72))).toEqual({ x: 0, y: 28 })
  })
  test('is zero when the box is already there', () => {
    expect(glideDelta(box(10, 20), box(10, 20))).toEqual({ x: 0, y: 0 })
  })
  test('ignores size: a commit snaps width and height, it does not move them', () => {
    expect(glideDelta(box(10, 20, 80, 72), box(10, 20, 54, 48))).toEqual({ x: 0, y: 0 })
  })
})

describe('hopDelta', () => {
  test('is x-only for two triggers in one row', () => {
    expect(hopDelta(box(100, 500), box(180, 500))).toEqual({ x: -80, y: 0 })
  })
  test('carries both axes across a wrapped row', () => {
    const from = box(100, 500)
    const to = box(180, 430)
    const delta = hopDelta(from, to)
    expect(delta).toEqual({ x: -80, y: 70 })
    // The panel starts where the outgoing trigger was, in the incoming frame.
    expect(to.left + delta.x).toBe(from.left)
    expect(to.top + delta.y).toBe(from.top)
  })
})

describe('sameRowBand', () => {
  test('two neighbours in one row share the band', () => {
    expect(sameRowBand(box(0, 500), box(80, 500))).toBe(true)
  })
  test('a wrapped display can have a slight vertical offset and still share it', () => {
    expect(sameRowBand(box(0, 500), box(80, 504))).toBe(true)
  })
  test('two wrapped rows do not share it', () => {
    expect(sameRowBand(box(0, 500), box(0, 572))).toBe(false)
  })
  test('requires half the shorter box, not a hair of overlap', () => {
    expect(sameRowBand(box(0, 500), box(0, 540), 0.5)).toBe(false)
    expect(sameRowBand(box(0, 500), box(0, 520), 0.5)).toBe(true)
  })
  test('a box with no height shares no band', () => {
    expect(sameRowBand(box(0, 500, 80, 0), box(0, 500, 80, 0))).toBe(false)
  })
})

describe('isStill', () => {
  test('compares the top-left corner only', () => {
    expect(isStill(box(10, 20), box(10, 20, 54, 48))).toBe(true)
    expect(isStill(box(10, 20), box(13, 20))).toBe(false)
  })
  test('an epsilon absorbs sub-pixel layout noise', () => {
    const eps = DOCK_BOX_EPSILON
    expect(isStill(box(10, 20), box(10 + eps * 0.9, 20 - eps * 0.9))).toBe(true)
    expect(isStill(box(10, 20), box(10 + eps, 20))).toBe(false)
  })
})

const GUARD = { guard: true }
const isGuard = (node: unknown) => node === GUARD
const record = (type: string, added: readonly unknown[] = [], removed: readonly unknown[] = []) => ({ type, added, removed })

describe('guardsOnly', () => {
  test('an empty batch is not a guard batch', () => {
    expect(guardsOnly([], isGuard)).toBe(false)
  })
  test('guard insertions alone are guard churn', () => {
    expect(guardsOnly([record('childList', [GUARD, GUARD])], isGuard)).toBe(true)
  })
  test('a guard removal alone is guard churn', () => {
    expect(guardsOnly([record('childList', [], [GUARD])], isGuard)).toBe(true)
  })
  test('a guard moving between parents is one batch', () => {
    expect(guardsOnly([record('childList', [], [GUARD]), record('childList', [GUARD])], isGuard)).toBe(true)
  })
  test('a real child alongside a guard falls through', () => {
    expect(guardsOnly([record('childList', [GUARD, {}])], isGuard)).toBe(false)
  })
  test('an attribute or character record falls through', () => {
    expect(guardsOnly([record('childList', [GUARD]), record('attributes')], isGuard)).toBe(false)
    expect(guardsOnly([record('characterData')], isGuard)).toBe(false)
  })
  test('a child-list record with no nodes is not guard churn', () => {
    expect(guardsOnly([record('childList')], isGuard)).toBe(false)
  })
})
