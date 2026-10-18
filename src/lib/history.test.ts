/// <reference types="bun" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { canRedo, canUndo, COALESCE_MS, emptyHistory, HISTORY_LIMIT, historyLabel, historyPath, isGestureTag, jump, record, stepAge, stepCount, stepDown, stepUp } from './history'

/**
 * A stand-in for the store's three moves, so the tree is exercised the way the
 * app drives it: commit *before* the mutation (with the board as it stands),
 * then restore what a step hands back. `board` is the live state, the thing the
 * store keeps outside the history.
 */
function machine(limit = HISTORY_LIMIT) {
  let tree = emptyHistory<number>()
  let board = 0
  let clock = 1000
  return {
    get tree() { return tree },
    get board() { return board },
    /** Run one action: commit the state it is about to change, then land `next`. */
    act(next: number, tag: string | null = null, now = (clock += 1000)) {
      tree = record(tree, board, now, tag, limit)
      board = next
      return this
    },
    undo() {
      const step = stepUp(tree, board)
      if (step) {
        tree = step.history
        board = step.snapshot
      }
      return this
    },
    redo() {
      const step = stepDown(tree, board)
      if (step) {
        tree = step.history
        board = step.snapshot
      }
      return this
    },
    jumpTo(id: string) {
      const step = jump(tree, id, board)
      if (step) {
        tree = step.history
        board = step.snapshot
      }
      return this
    },
    clock,
  }
}

describe('recording steps', () => {
  test('the first action opens the root and hangs its own step off it', () => {
    const m = machine().act(1, 'split')
    expect(stepCount(m.tree)).toBe(2)
    expect(historyPath(m.tree)).toEqual(['s1', 's2'])
    expect(m.tree.nodes.s1!.label).toBe('start')
    expect(m.tree.nodes.s1!.parent).toBeNull()
    expect(m.tree.nodes.s2!.parent).toBe('s1')
    expect(m.board).toBe(1)
    expect(canUndo(m.tree)).toBe(true)
    expect(canRedo(m.tree)).toBe(false)
  })

  test('undo reaches the state before the step, redo returns to the state after it', () => {
    const m = machine().act(1, 'split').act(2, 'split').act(3, 'rotatePane:p1')
    expect(m.board).toBe(3)
    m.undo()
    expect(m.board).toBe(2)
    m.undo()
    expect(m.board).toBe(1)
    m.redo()
    expect(m.board).toBe(2)
    m.redo()
    expect(m.board).toBe(3)
    expect(m.tree.cursor).toBe('s4')
  })

  test('a new action after undos branches instead of dropping the future', () => {
    const m = machine()
      .act(1, 'split') // s2
      .act(2, 'split') // s3
      .act(3, 'rotatePane:p1') // s4: branch A
    m.undo().undo()
    expect(m.board).toBe(1)
    m.act(4, 'addSticker') // s5: branch B, sibling of s3
    expect(m.tree.nodes.s2!.children).toEqual(['s3', 's5'])
    expect(m.tree.nodes.s2!.lastVisitedChild).toBe('s5')
    // Nothing of branch A was lost: its steps and their states are still there.
    expect(m.tree.nodes.s3!.parent).toBe('s2')
    expect(m.tree.nodes.s4!.snapshot).toBe(3)
    expect(historyPath(m.tree)).toEqual(['s1', 's2', 's5'])
  })

  test('an untagged commit never coalesces', () => {
    const m = machine().act(1).act(2, null, 1001)
    expect(stepCount(m.tree)).toBe(3)
  })
})

describe('coalescing a gesture', () => {
  test('a stream of commits inside the window keeps one step', () => {
    const m = machine()
      .act(1, 'rotatePane:p1', 1000)
      .act(2, 'rotatePane:p1', 1000 + COALESCE_MS - 1)
      .act(3, 'rotatePane:p1', 1000 + COALESCE_MS * 2 - 2)
    // Root + the gesture's step, nothing else.
    expect(stepCount(m.tree)).toBe(2)
    expect(m.tree.nodes.s2!.at).toBe(1000 + COALESCE_MS * 2 - 2)
    // Undoing the gesture returns to before it began.
    m.undo()
    expect(m.board).toBe(0)
    m.redo()
    expect(m.board).toBe(3)
  })

  test('a different tag, a gap longer than the window, or another target starts a new step', () => {
    const m = machine()
      .act(1, 'rotatePane:p1', 1000)
      .act(2, 'rotatePane:p1', 1000 + COALESCE_MS) // past the window
      .act(3, 'rotatePane:p2', 1000 + COALESCE_MS + 1) // another pane
    expect(stepCount(m.tree)).toBe(4)
  })

  test('only gestures coalesce: two quick clicks on a discrete action stay two steps', () => {
    expect(isGestureTag('rotatePane:p1')).toBe(true)
    expect(isGestureTag('setCanvasSize')).toBe(true)
    expect(isGestureTag('split')).toBe(false)
    const m = machine().act(1, 'split', 1000).act(2, 'split', 1001)
    expect(stepCount(m.tree)).toBe(3)
  })
})

describe('jumping', () => {
  test('jumping to a step of another branch restores it exactly, and redo follows that branch', () => {
    const m = machine()
      .act(1, 'split')
      .act(2, 'split')
      .act(3, 'rotatePane:p1') // branch A ends here
    m.undo().undo()
    m.act(4, 'addSticker') // branch B
    m.jumpTo('s3')
    expect(m.board).toBe(2)
    m.redo()
    expect(m.board).toBe(3)
    expect(m.tree.cursor).toBe('s4')
    // and back up into the branch point, then down the other side
    m.undo().undo()
    expect(m.tree.cursor).toBe('s2')
    m.redo()
    expect(m.board).toBe(2)
  })

  test('a jump is one move: it records no step of its own', () => {
    const m = machine().act(1, 'split').act(2, 'split')
    const count = stepCount(m.tree)
    m.jumpTo('s2')
    expect(stepCount(m.tree)).toBe(count)
    expect(m.tree.cursor).toBe('s2')
  })

  test('an unknown step and the cursor itself are not moves', () => {
    const m = machine().act(1, 'split')
    expect(jump(m.tree, 'nope', m.board)).toBeNull()
    expect(jump(m.tree, m.tree.cursor!, m.board)).toBeNull()
    expect(jump(emptyHistory<number>(), 's1', 0)).toBeNull()
  })

  test('the ends of the tree are the ends of the walk', () => {
    const empty = emptyHistory<number>()
    expect(stepUp(empty, 0)).toBeNull()
    expect(stepDown(empty, 0)).toBeNull()
    const m = machine().act(1, 'split').undo()
    expect(m.tree.cursor).toBe('s1')
    expect(stepUp(m.tree, m.board)).toBeNull()
    m.jumpTo('s2')
    expect(stepDown(m.tree, m.board)).toBeNull()
  })
})

describe('redo follows the visited child', () => {
  test('a second branch is reached only after visiting it', () => {
    const m = machine()
      .act(1, 'split') // s2
      .act(2, 'split') // s3
    m.undo() // at s2, having left s3
    m.act(3, 'addSticker') // s4, the newest child
    m.undo() // at s2 again, having left s4
    expect(m.tree.nodes.s2!.children).toEqual(['s3', 's4'])
    // Redo returns to the step we last stood in, not to the newest one.
    m.redo()
    expect(m.tree.cursor).toBe('s4')
    expect(m.board).toBe(3)
  })
})

describe('the cap', () => {
  test('the oldest leaves are pruned once they are behind the cursor', () => {
    const m = machine(8)
    for (let i = 1; i <= 20; i++)
      m.act(i, 'split')
    // A straight line is all cursor path: nothing is prunable yet.
    expect(stepCount(m.tree)).toBe(21)
    // Walk back up and record again: the steps left behind are now leaves.
    for (let i = 0; i < 19; i++)
      m.undo()
    m.act(100, 'addSticker')
    expect(stepCount(m.tree)).toBe(8)
    expect(m.tree.nodes.s1).toBeDefined()
    expect(historyPath(m.tree)).toEqual(['s1', 's2', 's22'])
    for (const id of historyPath(m.tree))
      expect(m.tree.nodes[id]).toBeDefined()
    expect(m.board).toBe(100)
  })

  test('a branch nobody is standing on goes before the cursor path', () => {
    const m = machine(6)
    for (let i = 1; i <= 5; i++)
      m.act(i, 'split') // s2..s6, a straight line
    m.undo().undo() // back to s4, leaving s5 → s6 behind
    m.act(6, 'addSticker') // s7: a second branch off s4
    m.act(7, 'addSticker') // s8
    // s5 → s6 is now a branch nobody stands on: it goes, oldest leaf first.
    expect(stepCount(m.tree)).toBe(6)
    expect(m.tree.nodes.s6).toBeUndefined()
    expect(m.tree.nodes.s5).toBeUndefined()
    expect(historyPath(m.tree)).toEqual(['s1', 's2', 's3', 's4', 's7', 's8'])
  })

  test('pruning re-points the way back down, so redo still has a child', () => {
    const m = machine(4)
    m.act(1, 'split').act(2, 'split') // s2 → s3
    m.undo() // at s2, having left s3
    for (let i = 3; i <= 12; i++)
      m.act(i, 'addSticker')
    expect(m.tree.nodes.s3).toBeUndefined() // the old leaf went
    const node = m.tree.nodes.s2!
    expect(node.children.length).toBeGreaterThan(0)
    for (const child of node.children)
      expect(m.tree.nodes[child]).toBeDefined()
    expect(node.lastVisitedChild == null || m.tree.nodes[node.lastVisitedChild] != null).toBe(true)
  })

  test('a tree that is nothing but the cursor path cannot shrink', () => {
    const m = machine(3)
    for (let i = 1; i <= 9; i++)
      m.act(i, 'split')
    // Nothing off the path is left to drop, and the path is never touched.
    expect(stepCount(m.tree)).toBe(10)
    expect(historyPath(m.tree)).toHaveLength(10)
    expect(m.board).toBe(9)
  })
})

describe('purity', () => {
  test('the same moves on the same inputs give the same tree', () => {
    const run = () => machine().act(1, 'split').act(2, 'rotatePane:p1').undo().act(3, 'addSticker').tree
    expect(run()).toEqual(run())
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })

  test('a transition never mutates the tree it was handed', () => {
    const m = machine().act(1, 'split').act(2, 'split')
    const before = JSON.stringify(m.tree)
    const frozen = structuredClone(m.tree)
    stepUp(m.tree, m.board)
    stepDown(m.tree, m.board)
    jump(m.tree, 's2', m.board)
    record(m.tree, m.board, 9999, 'split')
    expect(JSON.stringify(m.tree)).toBe(before)
    expect(m.tree).toEqual(frozen)
  })
})

describe('labels', () => {
  /**
   * Every tag the store commits, read off its own source: a new action that
   * forgets its label fails here rather than showing up in the panel as a
   * de-camel-cased guess.
   */
  function storeTags(): string[] {
    const src = readFileSync(join(import.meta.dir, '..', 'store.ts'), 'utf8')
    const tags = new Set<string>()
    for (const m of src.matchAll(/commit\(\s*(?:'([^']*)'|`([^`]*)`)/g)) {
      const tag = (m[1] ?? m[2]!).replace(/\$\{[^}]*\}/g, '')
      tags.add(tag.replace(/:$/, ''))
    }
    return [...tags].sort()
  }

  /** The English label (i18n key) each tag must resolve to. */
  const EXPECTED: Record<string, string> = {
    addGrid: 'New workspace',
    addLabel: 'Add text',
    addSticker: 'Add sticker',
    addWorkspace: 'Add workspace',
    assign: 'Place photo',
    assignMany: 'Place photos',
    autoFill: 'Fill empty panes',
    clearGridPhotos: 'Clear photos',
    closeEmptyPanes: 'Close empty panes',
    closeOtherPanes: 'Close other panes',
    closePane: 'Close pane',
    deletePane: 'Delete pane',
    duplicatePane: 'Duplicate pane',
    flipPane: 'Flip photo',
    moveSticker: 'Move sticker',
    moveWorkspace: 'Move workspace',
    pastePane: 'Paste pane',
    patch: 'Board look',
    removeGrid: 'Delete workspace',
    removeLabel: 'Remove text',
    removePhoto: 'Remove photo',
    removeSticker: 'Remove sticker',
    removeWorkspace: 'Delete workspace',
    renameGrid: 'Rename workspace',
    resetAllWorkspaces: 'Reset every workspace',
    resetPane: 'Reset pane',
    resetPaneRotation: 'Straighten photo',
    resetWorkspace: 'Reset workspace',
    resizeSplit: 'Resize panes',
    rotatePane: 'Rotate photo',
    rotateSticker: 'Rotate sticker',
    scaleSticker: 'Scale sticker',
    setCanvasSize: 'Canvas ratio',
    setLabel: 'Edit text',
    setPaneFilter: 'Filter photo',
    shuffleWorkspaces: 'Shuffle workspaces',
    split: 'Split pane',
    swapPhotos: 'Swap panes',
    updateLeaf: 'Pan the photo',
  }

  test('every tag the store commits has a label of its own', () => {
    const missing = storeTags().filter(tag => !(tag in EXPECTED))
    expect(missing).toEqual([])
  })

  test('each tag resolves to its English label, translated at the call site', () => {
    for (const [base, label] of Object.entries(EXPECTED))
      expect(historyLabel(`${base}:p1`)).toBe(label)
    // A gesture's per-gesture ids all read as the same action.
    expect(historyLabel('rotatePane:abc123')).toBe('Rotate photo')
    expect(historyLabel('patch:bg,bgGradient')).toBe('Background')
    expect(historyLabel('patch:gap,radius')).toBe('Photo gap')
    expect(historyLabel('patch:whatever')).toBe('Board look')
    // Untagged commits (and the root) still read as something.
    expect(historyLabel(null)).toBe('Edit')
    expect(historyLabel('start')).toBe('Start')
    // An action nobody taught us is de-camel-cased rather than dropped.
    expect(historyLabel('frobnicatePanes')).toBe('Frobnicate panes')
  })

  test('relative time buckets', () => {
    expect(stepAge(1000, 1000)).toBe('now')
    expect(stepAge(1000, 1000 + 42_000)).toEqual({ unit: 's', n: 42 })
    expect(stepAge(1000, 1000 + 5 * 60_000)).toEqual({ unit: 'm', n: 5 })
    expect(stepAge(1000, 1000 + 3 * 3_600_000)).toEqual({ unit: 'h', n: 3 })
  })
})
