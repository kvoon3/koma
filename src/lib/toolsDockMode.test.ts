/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { clampDockMode, dockModes, dockTransition } from './toolsDockMode'

const multi = { fitsOneRow: false }
const single = { fitsOneRow: true }

describe('dockTransition tap', () => {
  test('cycles collapsed → row → expanded → collapsed when content wraps', () => {
    expect(dockTransition('collapsed', { type: 'tap' }, multi)).toBe('row')
    expect(dockTransition('row', { type: 'tap' }, multi)).toBe('expanded')
    expect(dockTransition('expanded', { type: 'tap' }, multi)).toBe('collapsed')
  })
  test('skips expanded when content fits one row', () => {
    expect(dockTransition('collapsed', { type: 'tap' }, single)).toBe('row')
    expect(dockTransition('row', { type: 'tap' }, single)).toBe('collapsed')
  })
  test('stale expanded under single-row capacity behaves like row', () => {
    expect(dockTransition('expanded', { type: 'tap' }, single)).toBe('collapsed')
  })
})

describe('dockTransition snap / dismiss', () => {
  test('drag cannot snap to expanded when content fits one row', () => {
    expect(dockTransition('row', { type: 'snap', mode: 'expanded' }, single)).toBe('row')
    expect(dockTransition('row', { type: 'snap', mode: 'expanded' }, multi)).toBe('expanded')
  })
  test('snap to collapsed is honored', () => {
    expect(dockTransition('expanded', { type: 'snap', mode: 'collapsed' }, multi)).toBe('collapsed')
  })
  test('dismiss collapses', () => {
    expect(dockTransition('row', { type: 'dismiss' }, multi)).toBe('collapsed')
  })
})

describe('helpers', () => {
  test('dockModes / clampDockMode', () => {
    expect(dockModes(single)).toEqual(['collapsed', 'row'])
    expect(dockModes(multi)).toEqual(['collapsed', 'row', 'expanded'])
    expect(clampDockMode('expanded', single)).toBe('row')
    expect(clampDockMode('collapsed', single)).toBe('collapsed')
  })
})
