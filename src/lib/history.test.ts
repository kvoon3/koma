/// <reference types="bun" />
import type { History } from './history'
import type { TKey } from './locales/zh-Hans'
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

  test('acting from a step with children replaces the line redo would walk into', () => {
    // The product's example: 1 → 2 → [3, the cursor] → 4; acting at 3 replaces 4.
    const m = machine()
      .act(1, 'split') // s2
      .act(2, 'split') // s3
      .act(3, 'rotatePane:p1') // s4
    m.undo() // back to s3, having left s4
    expect(m.board).toBe(2)
    m.act(4, 'addSticker') // s5 takes s4's place
    expect(m.tree.nodes.s3!.children).toEqual(['s5'])
    expect(m.tree.nodes.s3!.lastVisitedChild).toBe('s5')
    expect(m.tree.nodes.s4).toBeUndefined()
    // No confirmation, no soft-delete state: the step is simply not there.
    expect(m.tree.nodes.s1!.children).toEqual(['s2'])
    expect(historyPath(m.tree)).toEqual(['s1', 's2', 's3', 's5'])
  })

  test('the replaced branch is destroyed: its whole subtree, not just its tail', () => {
    const m = machine()
      .act(1, 'split') // s2
      .act(2, 'split') // s3
      .act(3, 'rotatePane:p1') // s4
      .act(4, 'addSticker') // s5
    m.undo().undo() // back to s3, which still has s4 → s5 below it
    expect(m.board).toBe(2)
    expect(m.tree.cursor).toBe('s3')
    const count = stepCount(m.tree)
    m.act(5, 'addLabel') // s6 replaces s4 and everything under it
    expect(stepCount(m.tree)).toBe(count - 1)
    for (const gone of ['s4', 's5'])
      expect(m.tree.nodes[gone]).toBeUndefined()
    // Nothing can reach it back: no redo, no jump, no key.
    expect(canRedo(m.tree)).toBe(false)
    expect(jump(m.tree, 's4', m.board)).toBeNull()
    m.undo().redo()
    expect(m.board).toBe(5)
    expect(m.tree.cursor).toBe('s6')
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
    expect(isGestureTag('setCanvasFill')).toBe(true)
    expect(isGestureTag('split')).toBe(false)
    const m = machine().act(1, 'split', 1000).act(2, 'split', 1001)
    expect(stepCount(m.tree)).toBe(3)
  })
})

describe('jumping', () => {
  test('a jump restores that step exactly, and redo continues down from it', () => {
    const m = machine()
      .act(1, 'split')
      .act(2, 'split')
      .act(3, 'rotatePane:p1')
    m.jumpTo('s2')
    expect(m.board).toBe(1)
    m.redo()
    expect(m.board).toBe(2)
    m.redo()
    expect(m.board).toBe(3)
    expect(m.tree.cursor).toBe('s4')
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
  test('a jump into a step makes its child the way back down', () => {
    const m = machine().act(1, 'split').act(2, 'split').act(3, 'rotatePane:p1')
    m.jumpTo('s2')
    expect(m.tree.nodes.s2!.lastVisitedChild).toBe('s3')
    m.redo()
    expect(m.tree.cursor).toBe('s3')
    expect(m.board).toBe(2)
  })

  test('the visited child wins over the newest one on a tree that has a fork', () => {
    // Acting overwrites (see the header), so a session only ever builds a
    // chain: this pins the pure rule for the shape a forked tree would have.
    const forked = (): History<number> => ({
      nodes: {
        s1: { snapshot: 0, parent: null, children: ['s2', 's3'], lastVisitedChild: 's2', label: 'start', at: 1 },
        s2: { snapshot: 1, parent: 's1', children: [], lastVisitedChild: null, label: 'split', at: 2 },
        s3: { snapshot: 2, parent: 's1', children: [], lastVisitedChild: null, label: 'addLabel', at: 3 },
      },
      root: 's1',
      cursor: 's1',
      seq: 3,
    })
    const step = stepDown(forked(), 0)!
    expect(step.snapshot).toBe(1)
    expect(step.history.cursor).toBe('s2')
  })
})

describe('the cap', () => {
  test('a chain drops its oldest step once it is over the cap, cursor path included', () => {
    const m = machine(8)
    for (let i = 1; i <= 20; i++)
      m.act(i, 'split')
    // Acting always overwrites, so the tree is one chain: the oldest steps go.
    expect(stepCount(m.tree)).toBe(8)
    const path = historyPath(m.tree)
    expect(path).toHaveLength(8)
    expect(m.tree.root).toBe(path[0]!)
    expect(m.tree.cursor).toBe(path.at(-1)!)
    expect(m.tree.nodes.s1).toBeUndefined()
    expect(m.board).toBe(20)
    // What is left still walks: undo reaches the oldest state kept.
    for (let i = 0; i < 7; i++)
      m.undo()
    expect(canUndo(m.tree)).toBe(false)
    expect(m.board).toBe(13)
  })

  test('an off-path leaf goes before any step of the cursor path', () => {
    // A forked tree again: unreachable from a session now, so it is built by
    // hand to check that the cap protects the line the cursor stands on.
    const forked = (): History<number> => ({
      nodes: {
        s1: { snapshot: 0, parent: null, children: ['s2', 's3'], lastVisitedChild: 's3', label: 'start', at: 1 },
        s2: { snapshot: 1, parent: 's1', children: [], lastVisitedChild: null, label: 'split', at: 2 },
        s3: { snapshot: 2, parent: 's1', children: [], lastVisitedChild: null, label: 'addLabel', at: 3 },
      },
      root: 's1',
      cursor: 's3',
      seq: 3,
    })
    const tree = record(forked(), 2, 5000, 'addLabel', 3)
    expect(stepCount(tree)).toBe(3)
    expect(tree.nodes.s2).toBeUndefined() // the variant nobody stands on
    expect(historyPath(tree)).toEqual(['s1', 's3', 's4'])
  })

  test('pruning never leaves a parent pointing at a step that is gone', () => {
    const m = machine(4)
    m.act(1, 'split').act(2, 'split')
    m.undo() // at s2, having left s3
    for (let i = 3; i <= 12; i++)
      m.act(i, 'addSticker')
    for (const [id, node] of Object.entries(m.tree.nodes)) {
      for (const child of node.children)
        expect(m.tree.nodes[child]).toBeDefined()
      if (node.lastVisitedChild != null)
        expect(m.tree.nodes[node.lastVisitedChild]).toBeDefined()
      if (node.parent != null)
        expect(m.tree.nodes[node.parent]).toBeDefined()
      expect(id).toMatch(/^s\d+$/)
    }
    expect(historyPath(m.tree)).toHaveLength(4)
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
  const EXPECTED: Record<string, TKey> = {
    addGrid: 'Add board',
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
    moveGrid: 'Reorder boards',
    moveSticker: 'Move sticker',
    moveWorkspace: 'Move workspace',
    pastePane: 'Paste pane',
    patch: 'Board look',
    removeGrids: 'Delete boards',
    removeLabel: 'Remove text',
    removePhoto: 'Remove photo',
    removeSticker: 'Remove sticker',
    removeWorkspace: 'Delete workspace',
    resetAllWorkspaces: 'Reset every workspace',
    resetPane: 'Reset pane',
    resetPaneRotation: 'Straighten photo',
    resetWorkspace: 'Reset workspace',
    resizeSplit: 'Resize panes',
    rotatePane: 'Rotate photo',
    rotateSticker: 'Rotate sticker',
    scaleSticker: 'Scale sticker',
    setCanvasFill: 'Canvas size',
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

  test('each tag resolves to a key the call site translates', () => {
    for (const [base, label] of Object.entries(EXPECTED))
      expect(historyLabel(`${base}:p1`)).toEqual({ kind: 'key', key: label })
    // A gesture's per-gesture ids all read as the same action.
    expect(historyLabel('rotatePane:abc123')).toEqual({ kind: 'key', key: 'Rotate photo' })
    expect(historyLabel('patch:bg,bgGradient')).toEqual({ kind: 'key', key: 'Background' })
    expect(historyLabel('patch:gap,radius')).toEqual({ kind: 'key', key: 'Photo gap' })
    expect(historyLabel('patch:whatever')).toEqual({ kind: 'key', key: 'Board look' })
    // Untagged commits (and the root) still read as something.
    expect(historyLabel(null)).toEqual({ kind: 'key', key: 'Edit' })
    expect(historyLabel('start')).toEqual({ kind: 'key', key: 'Start' })
    // An action nobody taught us is de-camel-cased and shown as plain text.
    expect(historyLabel('frobnicatePanes')).toEqual({ kind: 'text', text: 'Frobnicate panes' })
  })

  test('relative time buckets', () => {
    expect(stepAge(1000, 1000)).toBe('now')
    expect(stepAge(1000, 1000 + 42_000)).toEqual({ unit: 's', n: 42 })
    expect(stepAge(1000, 1000 + 5 * 60_000)).toEqual({ unit: 'm', n: 5 })
    expect(stepAge(1000, 1000 + 3 * 3_600_000)).toEqual({ unit: 'h', n: 3 })
  })
})
