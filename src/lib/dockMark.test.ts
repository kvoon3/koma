/// <reference types="bun" />
import type { DockMarkEvent, DockMarks, DockPointerFacts } from './dockMark'
import { describe, expect, test } from 'bun:test'
import { EMPTY_MARKS, markOf, reduceDockMarks } from './dockMark'

interface El {
  readonly id: string
}
const a: El = { id: 'a' }
const b: El = { id: 'b' }
const c: El = { id: 'c' }

const FACTS: DockPointerFacts = { kind: 'popover', pointer: 'mouse', disabled: false, locked: false, aligned: true }
const facts = (patch: Partial<DockPointerFacts> = {}): DockPointerFacts => ({ ...FACTS, ...patch })
const hover = (el: El | null, f: DockPointerFacts = FACTS, hop: { x: number, y: number } | null = { x: 12, y: -3 }): DockMarkEvent<El> => ({ type: 'hover', el, facts: f, hop })

function pressed(el: El): DockMarks<El> {
  return reduceDockMarks(EMPTY_MARKS, { type: 'open', el })
}

function hovered(el: El): DockMarks<El> {
  return reduceDockMarks(pressed(a), hover(el))
}

describe('markOf', () => {
  test('a press wins over a hover', () => {
    expect(markOf({ open: null, hover: a, press: b })).toBe(b)
    expect(markOf({ open: null, hover: a, press: null })).toBe(a)
    expect(markOf(EMPTY_MARKS)).toBeNull()
  })
})

describe('reduceDockMarks hover', () => {
  test('hover alone opens nothing and marks the button', () => {
    const next = reduceDockMarks(EMPTY_MARKS, hover(a))
    expect(next.open).toBeNull()
    expect(next.hover).toBe(a)
  })
  test('hover on a plain action with a panel open marks without handing over', () => {
    const next = reduceDockMarks(pressed(a), hover(b, facts({ kind: 'plain' })))
    expect(next.open?.el).toBe(a)
    expect(next.hover).toBe(b)
  })
  test('hover hands over only on a mouse over another eligible popover trigger', () => {
    const next = reduceDockMarks(pressed(a), hover(b))
    expect(next.open?.source).toBe('hover')
    expect(next.open?.el).toBe(b)
    expect(next.open?.fromEl).toBe(a)
    expect(next.open?.hop).toEqual({ x: 12, y: -3 })
    expect(next.hover).toBe(b)
  })
  test('a touch pointer never hands over', () => {
    const next = reduceDockMarks(pressed(a), hover(b, facts({ pointer: 'other' })))
    expect(next.open?.el).toBe(a)
    expect(next.hover).toBe(b)
  })
  test.each([
    ['disabled', { disabled: true }],
    ['locked', { locked: true }],
    ['misaligned', { aligned: false }],
    ['plain', { kind: 'plain' as const }],
  ])('a %s candidate is marked but does not hand over', (_name, patch) => {
    const next = reduceDockMarks(pressed(a), hover(b, facts(patch)))
    expect(next.open?.el).toBe(a)
    expect(next.hover).toBe(b)
  })
  test('the open trigger itself is a no-op beyond the mark', () => {
    const state: DockMarks<El> = { ...pressed(a), hover: a }
    expect(reduceDockMarks(state, hover(a))).toBe(state)
    const first = reduceDockMarks(pressed(a), hover(a))
    expect(first.open?.el).toBe(a)
    expect(first.hover).toBe(a)
  })
  test('hover(null) clears the mark and leaves the panel', () => {
    const state = hovered(b)
    const next = reduceDockMarks(state, hover(null))
    expect(next.hover).toBeNull()
    expect(next.open?.el).toBe(b)
  })
  test('a repeated pointerover on the same button changes nothing', () => {
    const state = hovered(b)
    expect(reduceDockMarks(state, hover(b))).toBe(state)
  })
  test('a missing hop falls back to zero travel', () => {
    const next = reduceDockMarks(pressed(a), hover(b, FACTS, null))
    expect(next.open?.hop).toEqual({ x: 0, y: 0 })
  })
})

describe('reduceDockMarks press and release', () => {
  test('a press marks the button and never opens anything', () => {
    const next = reduceDockMarks(EMPTY_MARKS, { type: 'press', el: a, disabled: false })
    expect(next.press).toBe(a)
    expect(next.open).toBeNull()
  })
  test('a disabled press is rejected', () => {
    const state = EMPTY_MARKS
    expect(reduceDockMarks(state, { type: 'press', el: a, disabled: true })).toBe(state)
  })
  test('a repeated press on the same button changes nothing', () => {
    const state = reduceDockMarks(EMPTY_MARKS, { type: 'press', el: a, disabled: false })
    expect(reduceDockMarks(state, { type: 'press', el: a, disabled: false })).toBe(state)
  })
  test('release clears the press only', () => {
    const state = { open: null, hover: a, press: b }
    const next = reduceDockMarks(state, { type: 'release' })
    expect(next.press).toBeNull()
    expect(next.hover).toBe(a)
  })
  test('leave clears the mark and retains the open panel', () => {
    const state: DockMarks<El> = { open: pressed(a).open, hover: b, press: c }
    const next = reduceDockMarks(state, { type: 'leave' })
    expect(next.hover).toBeNull()
    expect(next.press).toBeNull()
    expect(next.open?.el).toBe(a)
  })
  test('leave with nothing marked is the same state', () => {
    const state = pressed(a)
    expect(reduceDockMarks(state, { type: 'leave' })).toBe(state)
  })
})

describe('reduceDockMarks open, close, stick, dismiss', () => {
  test('a press open replaces the current panel', () => {
    const next = reduceDockMarks(pressed(a), { type: 'open', el: b })
    expect(next.open).toEqual({ source: 'press', el: b, fromEl: null, hop: null })
  })
  test('re-opening the press-owned panel is a no-op', () => {
    const state = pressed(a)
    expect(reduceDockMarks(state, { type: 'open', el: a })).toBe(state)
  })
  test('close clears the panel it names', () => {
    expect(reduceDockMarks(pressed(a), { type: 'close', el: a }).open).toBeNull()
  })
  test('a stale sibling close keeps the current panel', () => {
    const state = pressed(a)
    expect(reduceDockMarks(state, { type: 'close', el: b })).toBe(state)
  })
  test('stick turns a hover-open into a press-open', () => {
    const next = reduceDockMarks(hovered(b), { type: 'stick', el: b })
    expect(next.open).toEqual({ source: 'press', el: b, fromEl: null, hop: null })
  })
  test('stick does not touch a press-open or another trigger', () => {
    const state = pressed(a)
    expect(reduceDockMarks(state, { type: 'stick', el: a })).toBe(state)
    expect(reduceDockMarks(state, { type: 'stick', el: b })).toBe(state)
    expect(reduceDockMarks(hovered(b), { type: 'stick', el: a }).open?.source).toBe('hover')
  })
  test('dismiss clears the panel and leaves the mark', () => {
    const state = hovered(b)
    const next = reduceDockMarks(state, { type: 'dismiss' })
    expect(next.open).toBeNull()
    expect(next.hover).toBe(b)
  })
})

describe('reduceDockMarks unmount', () => {
  test('a removed trigger drops every claim it owned', () => {
    const state: DockMarks<El> = { open: pressed(a).open, hover: a, press: a }
    const next = reduceDockMarks(state, { type: 'unmount', el: a })
    expect(next).toEqual({ open: null, hover: null, press: null })
  })
  test('a removed sibling leaves another trigger’s claims', () => {
    const state: DockMarks<El> = { open: pressed(a).open, hover: b, press: b }
    expect(reduceDockMarks(state, { type: 'unmount', el: a })).toEqual({ open: null, hover: b, press: b })
  })
  test('an unrelated removal changes nothing', () => {
    const state = pressed(a)
    expect(reduceDockMarks(state, { type: 'unmount', el: c })).toBe(state)
  })
})
