/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DOCK_FLIP_EASE_CSS, DOCK_FLIP_S, flipStart, isBoxVisible, isFlipMove, parseTranslate, planFlipItem, shiftFlipBox } from './dockFlip'

const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h })
/** The scroller's clip rect: a 375×278 viewport at the sheet's origin. */
const view = box(0, 0, 375, 278)

describe('flipStart', () => {
  test('is the translate that puts the old box back on screen', () => {
    expect(flipStart(box(120, 600, 80, 70), box(28, 640, 80, 70))).toEqual({ x: 92, y: -40 })
  })
  test('the same box is no move', () => {
    const b = box(10, 20, 80, 70)
    expect(flipStart(b, b)).toEqual({ x: 0, y: 0 })
    expect(isFlipMove(flipStart(b, b))).toBe(false)
  })
  test('sub-pixel layout noise is not a move, a real one is', () => {
    expect(isFlipMove({ x: 0.4, y: -0.4 })).toBe(false)
    expect(isFlipMove({ x: 0.5, y: 0 })).toBe(true)
    expect(isFlipMove({ x: 0, y: -12 })).toBe(true)
  })
  test('shiftFlipBox carries an in-flight translate (interrupted flip)', () => {
    expect(shiftFlipBox(box(100, 100, 80, 70), 7, -3)).toEqual(box(107, 97, 80, 70))
  })
})

describe('isBoxVisible', () => {
  test('a box inside the clip is visible', () => {
    expect(isBoxVisible(box(40, 20, 80, 70), view)).toBe(true)
  })
  test('partly scrolled past the edge still counts as visible', () => {
    expect(isBoxVisible(box(-60, 20, 80, 70), view)).toBe(true)
  })
  test('fully clipped on any side is not', () => {
    expect(isBoxVisible(box(-80, 20, 80, 70), view)).toBe(false)
    expect(isBoxVisible(box(375, 20, 80, 70), view)).toBe(false)
    expect(isBoxVisible(box(40, -70, 80, 70), view)).toBe(false)
    expect(isBoxVisible(box(40, 278, 80, 70), view)).toBe(false)
  })
})

describe('planFlipItem', () => {
  test('a tool that stays on screen only glides (row → wrapped rows)', () => {
    const plan = planFlipItem({ from: box(160, 100, 80, 70), to: box(100, 200, 80, 70), view })
    expect(plan).toEqual({ x: 60, y: -100, enter: false, visible: true })
  })
  test('a tool past the row\'s scroll edge fades in as the wrap reveals it', () => {
    const plan = planFlipItem({ from: box(520, 100, 80, 70), to: box(28, 200, 80, 70), view })
    expect(plan).toEqual({ x: 492, y: -100, enter: true, visible: true })
  })
  test('an exit slides out under the clip edge, no fade (the new box is clipped)', () => {
    const plan = planFlipItem({ from: box(28, 200, 80, 70), to: box(520, 100, 80, 70), view })
    expect(plan.x).toBe(-492)
    expect(plan.visible).toBe(false)
    expect(plan.enter).toBe(false)
  })
  test('a tool clipped on both sides of the flip does not animate', () => {
    // e.g. a long list: both the row's tail and the wrapped block's fold.
    const plan = planFlipItem({ from: box(1200, 100, 80, 70), to: box(28, 900, 80, 70), view })
    expect(plan).toEqual({ x: 0, y: 0, enter: false, visible: false })
  })
  test('a tool with no previous box (a fresh mount) just appears', () => {
    const plan = planFlipItem({ from: null, to: box(40, 20, 80, 70), view })
    expect(plan).toEqual({ x: 0, y: 0, enter: false, visible: true })
  })
  test('a flipped box that only moved a hair does not spin up an animation', () => {
    const plan = planFlipItem({ from: box(40, 20.2, 80, 70), to: box(40, 20, 80, 70), view })
    expect(plan).toEqual({ x: 0, y: 0, enter: false, visible: true })
  })
})

describe('parseTranslate', () => {
  test('no transform is no translate', () => {
    expect(parseTranslate('none')).toEqual({ x: 0, y: 0 })
    expect(parseTranslate('')).toEqual({ x: 0, y: 0 })
    expect(parseTranslate(null)).toEqual({ x: 0, y: 0 })
  })
  test('reads the translation column of a 2d matrix', () => {
    expect(parseTranslate('matrix(1, 0, 0, 1, 92, -40)')).toEqual({ x: 92, y: -40 })
  })
  test('reads the translation column of a 3d matrix', () => {
    expect(parseTranslate('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12.5, -8, 0, 1)')).toEqual({ x: 12.5, y: -8 })
  })
  test('a bare scale or a garbage value carries no translate', () => {
    expect(parseTranslate('matrix(0.97, 0, 0, 0.97, 0, 0)')).toEqual({ x: 0, y: 0 })
    expect(parseTranslate('rotate(3deg)')).toEqual({ x: 0, y: 0 })
  })
})

describe('DOCK_FLIP_S', () => {
  test('sits in the caption fade\'s window so the flip reads as one morph', () => {
    expect(DOCK_FLIP_S).toBeGreaterThanOrEqual(0.12)
    expect(DOCK_FLIP_S).toBeLessThanOrEqual(0.15)
  })
  test('the WAAPI easing is --ease-out from index.css', () => {
    expect(DOCK_FLIP_EASE_CSS).toBe('cubic-bezier(0.23, 1, 0.32, 1)')
  })
})
