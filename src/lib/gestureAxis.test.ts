/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { lockedAxis, PAGER_SLOP, PULL_COMMIT, PULL_DOMINANCE } from './gestureAxis'

describe('the shared gesture thresholds', () => {
  test('a press is a click under the slop and a drag past it', () => {
    expect(PAGER_SLOP).toBe(6)
    expect(PULL_COMMIT).toBeGreaterThan(PAGER_SLOP)
    expect(PULL_DOMINANCE).toBeGreaterThan(1)
  })
})

describe('lockedAxis', () => {
  test('a mostly sideways gesture is the horizontal pager', () => {
    expect(lockedAxis(20, 0)).toBe('x')
    expect(lockedAxis(-20, 8)).toBe('x')
    expect(lockedAxis(120, 99)).toBe('x')
  })

  test('a mostly vertical gesture is the pull', () => {
    expect(lockedAxis(0, 20)).toBe('y')
    expect(lockedAxis(8, -20)).toBe('y')
    expect(lockedAxis(99, 120)).toBe('y')
  })

  test('a diagonal has not decided, so neither gesture takes it', () => {
    expect(lockedAxis(20, 20)).toBe(null)
    // Inside the dominance factor, not past it.
    expect(lockedAxis(20, 19)).toBe(null)
    expect(lockedAxis(19, 20)).toBe(null)
    expect(lockedAxis(0, 0)).toBe(null)
  })

  test('the dominance factor is exclusive', () => {
    expect(lockedAxis(10 * PULL_DOMINANCE, 10)).toBe(null)
    expect(lockedAxis(10 * PULL_DOMINANCE + 0.01, 10)).toBe('x')
    expect(lockedAxis(10, 10 * PULL_DOMINANCE + 0.01)).toBe('y')
  })
})
