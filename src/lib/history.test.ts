/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { canRedo, canUndo, COALESCE_MS, emptyHistory, HISTORY_LIMIT, record, redoStep, undoStep } from './history'

/** Snapshots are opaque here: the stack only moves them around. */
const start = () => emptyHistory<number>()

describe('record', () => {
  test('pushes the pre-mutation state and drops the redo path', () => {
    // 0 -> 1 -> 2, then undo (2 back to 1), then a new action (1 -> 3).
    let h = record(start(), 0, 1000)
    h = record(h, 1, 2000)
    const step = undoStep(h, 2)!
    expect(step.snapshot).toBe(1)
    h = record(step.history, 1, 3000)
    expect(h.past).toEqual([0, 1])
    expect(h.future).toEqual([])
    expect(canRedo(h)).toBe(false)
  })

  test('caps the stack at the limit, dropping the oldest entries', () => {
    let h = start()
    for (let i = 0; i < HISTORY_LIMIT + 25; i++)
      h = record(h, i, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]).toBe(25)
    expect(h.past.at(-1)).toBe(HISTORY_LIMIT + 24)
  })

  test('collapses a gesture\'s stream of commits into its first snapshot', () => {
    let h = emptyHistory<string>()
    h = record(h, 'before-drag', 1000, 'move:t1')
    h = record(h, 'drag-1', 1000 + COALESCE_MS - 1, 'move:t1')
    h = record(h, 'drag-2', 1000 + COALESCE_MS * 2 - 2, 'move:t1')
    expect(h.past).toEqual(['before-drag'])
    // A different tag, or a gap longer than the window, starts a new entry.
    h = record(h, 'after', 1000 + COALESCE_MS * 3, 'move:t2')
    expect(h.past).toEqual(['before-drag', 'after'])
    h = record(h, 'later', 1000 + COALESCE_MS * 4, 'move:t2')
    expect(h.past).toEqual(['before-drag', 'after', 'later'])
  })

  test('untagged commits never coalesce', () => {
    let h = record(start(), 0, 1000)
    h = record(h, 1, 1000)
    expect(h.past).toEqual([0, 1])
  })
})

describe('undo / redo stepping', () => {
  test('a roundtrip returns the same snapshot and restores the stacks', () => {
    const h = record(record(start(), 0, 1), 1, 2)
    const back = undoStep(h, 2)!
    expect(back.snapshot).toBe(1)
    const forward = redoStep(back.history, 1)!
    expect(forward.snapshot).toBe(2)
    expect(forward.history.past).toEqual([0, 1])
    expect(forward.history.future).toEqual([])
  })

  test('an empty stack has nothing to step to', () => {
    const empty = start()
    expect(undoStep(empty, 0)).toBeNull()
    expect(redoStep(empty, 0)).toBeNull()
    expect(canUndo(empty)).toBe(false)
    expect(canRedo(empty)).toBe(false)
  })

  test('undo to the bottom then redo all the way back up', () => {
    let h = record(record(record(start(), 0, 1), 1, 2), 2, 3)
    let current = 3
    for (const expected of [2, 1, 0]) {
      const step = undoStep(h, current)!
      h = step.history
      current = step.snapshot
      expect(current).toBe(expected)
    }
    expect(canUndo(h)).toBe(false)
    expect(undoStep(h, current)).toBeNull()
    for (const expected of [1, 2, 3]) {
      const step = redoStep(h, current)!
      h = step.history
      current = step.snapshot
      expect(current).toBe(expected)
    }
    expect(canRedo(h)).toBe(false)
  })

  test('redo also respects the cap', () => {
    let h = start()
    for (let i = 0; i < HISTORY_LIMIT; i++)
      h = record(h, i, i)
    // Undo everything, then redo it all: the past refills to the same cap.
    let current = HISTORY_LIMIT
    while (canUndo(h)) {
      const step = undoStep(h, current)!
      h = step.history
      current = step.snapshot
    }
    while (canRedo(h)) {
      const step = redoStep(h, current)!
      h = step.history
      current = step.snapshot
    }
    expect(h.past.length).toBeLessThanOrEqual(HISTORY_LIMIT)
    expect(h.future).toHaveLength(0)
  })
})
