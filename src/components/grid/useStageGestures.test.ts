/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { isBlankStageTarget, LONG_PRESS_MS } from './useStageGestures'

/** A target whose `closest` answers for exactly the selectors it matches. */
function targetOf(...matched: string[]) {
  return {
    closest: (selector: string) =>
      selector.split(',').some(s => matched.includes(s.trim())) ? {} : null,
  }
}

describe('isBlankStageTarget', () => {
  test('a bare stage element is blank', () => {
    expect(isBlankStageTarget(targetOf())).toBe(true)
    expect(isBlankStageTarget({ closest: () => null })).toBe(true)
  })

  test('nothing that owns a press is blank', () => {
    expect(isBlankStageTarget(targetOf('[data-cell]'))).toBe(false)
    expect(isBlankStageTarget(targetOf('[data-dock-mode]'))).toBe(false)
    expect(isBlankStageTarget(targetOf('button'))).toBe(false)
    expect(isBlankStageTarget(targetOf('a'))).toBe(false)
    expect(isBlankStageTarget(targetOf('[role="dialog"]'))).toBe(false)
    expect(isBlankStageTarget(targetOf('input'))).toBe(false)
    expect(isBlankStageTarget(targetOf('textarea'))).toBe(false)
  })

  test('a missing target is not blank', () => {
    expect(isBlankStageTarget(null)).toBe(false)
    expect(isBlankStageTarget(undefined)).toBe(false)
  })
})

describe('LONG_PRESS_MS', () => {
  test('the long press is about half a second', () => {
    expect(LONG_PRESS_MS).toBe(500)
  })
})
