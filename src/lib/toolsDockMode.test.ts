/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { clampDockMode, dockHandleIntent, dockModes, dockTransition } from './toolsDockMode'

const multi = { fitsOneRow: false }
const single = { fitsOneRow: true }

describe('dockModes', () => {
  test('three displays when the tools wrap, two when they fit one row', () => {
    expect(dockModes(single)).toEqual(['icons', 'row'])
    expect(dockModes(multi)).toEqual(['icons', 'row', 'expanded'])
  })
  test('there is no put-away mode left', () => {
    expect(dockModes(single) as readonly string[]).not.toContain('collapsed')
    expect(dockModes(multi) as readonly string[]).not.toContain('collapsed')
  })
})

describe('dockTransition tap', () => {
  test('cycles icons → row → expanded → icons when the tools wrap', () => {
    expect(dockTransition('icons', { type: 'tap' }, multi)).toBe('row')
    expect(dockTransition('row', { type: 'tap' }, multi)).toBe('expanded')
    expect(dockTransition('expanded', { type: 'tap' }, multi)).toBe('icons')
  })
  test('skips expanded when the tools fit one row', () => {
    expect(dockTransition('icons', { type: 'tap' }, single)).toBe('row')
    expect(dockTransition('row', { type: 'tap' }, single)).toBe('icons')
  })
  test('stale expanded under single-row capacity behaves like row', () => {
    expect(dockTransition('expanded', { type: 'tap' }, single)).toBe('icons')
  })
})

describe('dockTransition snap / dismiss', () => {
  test('drag cannot snap to expanded when the tools fit one row', () => {
    expect(dockTransition('row', { type: 'snap', mode: 'expanded' }, single)).toBe('row')
    expect(dockTransition('row', { type: 'snap', mode: 'expanded' }, multi)).toBe('expanded')
  })
  test('snap to icons is honored', () => {
    expect(dockTransition('expanded', { type: 'snap', mode: 'icons' }, multi)).toBe('icons')
    expect(dockTransition('row', { type: 'snap', mode: 'icons' }, single)).toBe('icons')
  })
  test('dismiss lands on the icon-only row, not on a hidden sheet', () => {
    expect(dockTransition('row', { type: 'dismiss' }, multi)).toBe('icons')
    expect(dockTransition('expanded', { type: 'dismiss' }, multi)).toBe('icons')
    expect(dockTransition('icons', { type: 'dismiss' }, multi)).toBe('icons')
  })
})

describe('clampDockMode', () => {
  test('expanded collapses to the labelled row when one row fits', () => {
    expect(clampDockMode('expanded', single)).toBe('row')
    expect(clampDockMode('expanded', multi)).toBe('expanded')
    expect(clampDockMode('icons', single)).toBe('icons')
    expect(clampDockMode('row', multi)).toBe('row')
  })
})

describe('dockHandleIntent', () => {
  test('follows the next tap', () => {
    expect(dockHandleIntent('icons', multi)).toBe('expand')
    expect(dockHandleIntent('row', multi)).toBe('expand')
    expect(dockHandleIntent('expanded', multi)).toBe('collapse')
    expect(dockHandleIntent('icons', single)).toBe('expand')
    expect(dockHandleIntent('row', single)).toBe('collapse')
  })
})
