/// <reference types="bun" />
import { beforeEach, describe, expect, test } from 'bun:test'
import { degToRad, radToDeg } from './lib/detent'
import { mulberry32 } from './lib/gridTools'
import { canRedo, canUndo, emptyHistory, HISTORY_LIMIT, historyPath, stepCount } from './lib/history'
import { leafList, rotationOf } from './lib/panes'
import { MAX_GRIDS } from './lib/workspaces'

// The board's mutations run inside `runPaneMorph`, which falls back to a
// synchronous change when the browser has no View Transition API. A bare
// stand-in gives the store exactly that fallback under `bun test`.
Object.assign(globalThis, {
  document: {
    startViewTransition: undefined,
    querySelectorAll: () => [],
    documentElement: { dataset: {} },
  },
})

// zustand's `persist` writes through `window.localStorage`, which bun does not
// provide: an in-memory stand-in keeps the middleware quiet and lets a test
// read the payload it would have saved.
const saved = new Map<string, string>()
const storage = {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => void saved.set(k, v),
  removeItem: (k: string) => void saved.delete(k),
  clear: () => saved.clear(),
}
Object.assign(globalThis, { window: { localStorage: storage }, localStorage: storage })

const { activeWs, boardOf, useStore } = await import('./store')

/** The store as it booted: each test starts from a blank board and no history. */
const boot = useStore.getState()

beforeEach(() => {
  useStore.setState({ ...boot, history: emptyHistory() })
})

const ws = () => activeWs(useStore.getState())
const leaves = () => leafList(ws().root)
const tree = () => useStore.getState().history
/** How many steps undo can walk back through: the cursor's depth. */
const depth = () => Math.max(0, historyPath(tree()).length - 1)
/** How many steps a redo walks down into (the cursor's children). */
const ahead = () => (tree().cursor == null ? 0 : tree().nodes[tree().cursor!]!.children.length)

describe('undo / redo over the pane tree', () => {
  test('a split is undone back to the exact tree and redone', () => {
    const before = ws().root
    expect(leaves()).toHaveLength(1)

    useStore.getState().split(ws().focusId, 'row')
    expect(leaves()).toHaveLength(2)
    const split = ws().root
    expect(depth()).toBe(1)

    useStore.getState().undo()
    expect(leaves()).toHaveLength(1)
    // The restored tree is the very object the split started from.
    expect(ws().root).toBe(before)
    expect(ahead()).toBe(1)

    useStore.getState().redo()
    expect(depth()).toBe(1)
    expect(ws().root).toBe(split)
    expect(ahead()).toBe(0)
  })

  test('close / duplicate / delete roundtrip too', () => {
    const store = useStore.getState()
    store.split(ws().focusId, 'row')
    const [, right] = leaves()
    const twoPane = ws().root

    useStore.getState().closePane(right!.id)
    expect(leaves()).toHaveLength(1)
    useStore.getState().undo()
    expect(ws().root).toBe(twoPane)

    useStore.getState().duplicatePane(leaves()[0]!.id, 'column')
    expect(leaves()).toHaveLength(3)
    useStore.getState().undo()
    expect(ws().root).toBe(twoPane)

    useStore.getState().deletePane(leaves()[0]!.id)
    expect(leaves()).toHaveLength(1)
    useStore.getState().undo()
    expect(ws().root).toBe(twoPane)
  })

  test('pane view, ratio and photo placement are undoable', () => {
    const paneId = ws().focusId
    const original = ws().root

    useStore.getState().updateLeaf(paneId, { zoom: 2.5, cx: 0.2, cy: 0.7 })
    useStore.getState().undo()
    expect(ws().root).toBe(original)

    useStore.getState().assign(paneId, 'photo-1')
    expect(leaves()[0]!.photoId).toBe('photo-1')
    useStore.getState().undo()
    expect(leaves()[0]!.photoId).toBeNull()

    useStore.getState().removePhoto(paneId)
    useStore.getState().undo()
    expect(ws().root).toBe(original)

    useStore.getState().split(paneId, 'row')
    const splitId = ws().root.type === 'split' ? ws().root.id : null
    expect(splitId).not.toBeNull()
    useStore.getState().resizeSplit(splitId!, 0.3)
    const narrow = ws().root
    useStore.getState().undo()
    expect(ws().root).not.toBe(narrow)
    useStore.getState().redo()
    expect(ws().root).toBe(narrow)
  })

  test('a drag\'s stream of resolutions is one undo step', () => {
    useStore.getState().split(ws().focusId, 'row')
    const split = ws().root as { type: 'split', id: string }
    const beforeDrag = ws().root
    for (const ratio of [0.6, 0.55, 0.5, 0.45, 0.4])
      useStore.getState().resizeSplit(split.id, ratio)
    expect(depth()).toBe(2)
    useStore.getState().undo()
    expect(ws().root).toBe(beforeDrag)
  })

  test('board stickers and labels are undoable', () => {
    const store = useStore.getState()
    store.addSticker('photo-1', 0.4, 0.6)
    expect(ws().stickers).toHaveLength(1)
    useStore.getState().undo()
    expect(ws().stickers).toHaveLength(0)

    const labelId = useStore.getState().addLabel(0.3, 0.3)
    expect(ws().labels).toHaveLength(1)
    useStore.getState().setLabel(labelId, { text: 'hi' })
    expect(ws().labels[0]!.text).toBe('hi')
    useStore.getState().undo()
    expect(ws().labels[0]!.text).not.toBe('hi')
    useStore.getState().undo()
    expect(ws().labels).toHaveLength(0)

    useStore.getState().addSticker('photo-1')
    useStore.getState().removeSticker(ws().stickers[0]!.id)
    expect(ws().stickers).toHaveLength(0)
    useStore.getState().undo()
    expect(ws().stickers).toHaveLength(1)
  })

  test('canvas ratio and background changes are undoable', () => {
    useStore.getState().setCanvasSize(2 / 3, 0.8)
    expect(ws().canvasRatio).toBeCloseTo(2 / 3)
    useStore.getState().undo()
    expect(ws().canvasRatio).toBeNull()
    expect(ws().canvasFill).toBe(1)

    useStore.getState().patch({ bg: '#ffffff', bgGradient: '#000000' })
    expect(useStore.getState().bg).toBe('#ffffff')
    useStore.getState().undo()
    expect(useStore.getState().bg).not.toBe('#ffffff')
    expect(useStore.getState().bgGradient).toBeNull()

    // Settings that are not part of the board never reach the history.
    const steps = depth()
    useStore.getState().patch({ gap: 40, radius: 12, activeId: ws().id })
    expect(depth()).toBe(steps)
  })

  test('dragging the background colour is one undo step', () => {
    const steps = depth()
    for (const bg of ['#111111', '#222222', '#333333'])
      useStore.getState().patch({ bg })
    expect(depth()).toBe(steps + 1)
    useStore.getState().undo()
    expect(useStore.getState().bg).toBe(boot.bg)
  })
})

describe('undo / redo over the workspace grid', () => {
  test('an added workspace slot goes away again', () => {
    const added = useStore.getState().addWorkspace()
    expect(added).not.toBeNull()
    expect(useStore.getState().workspaces.some(w => w.id === added)).toBe(true)
    // Entering the new cell is navigation, not a board mutation.
    useStore.getState().patch({ activeId: added! })
    useStore.getState().undo()
    expect(useStore.getState().workspaces.some(w => w.id === added)).toBe(false)
    // Its active slot is gone, so the view returns to where it came from.
    expect(useStore.getState().activeId).toBe(ws().id)
  })

  test('a removed slot comes back with its board', () => {
    useStore.getState().split(ws().focusId, 'row')
    const id = ws().id
    const twoPane = ws().root
    useStore.getState().removeWorkspace(id)
    expect(useStore.getState().workspaces.some(w => w.id === id)).toBe(false)
    useStore.getState().undo()
    const back = useStore.getState().workspaces.find(w => w.id === id)
    expect(back).toBeDefined()
    expect(back!.root).toBe(twoPane)
  })

  test('reset workspace, shuffle and clear are undoable', () => {
    useStore.getState().split(ws().focusId, 'row')
    const twoPane = ws().root
    useStore.getState().resetWorkspace(ws().id)
    expect(leaves()).toHaveLength(1)
    useStore.getState().undo()
    expect(ws().root).toBe(twoPane)

    // Two filled cells are what shuffle reorders; which way it permutes them is
    // the PRNG's business, so the test pins the roundtrip, not the result.
    const second = useStore.getState().addWorkspace()!
    useStore.getState().patch({ activeId: second })
    useStore.getState().assign(ws().focusId, 'photo-2')
    useStore.getState().patch({ activeId: boot.activeId })
    useStore.getState().assign(ws().focusId, 'photo-1')
    const order = useStore.getState().workspaces
    const steps = depth()
    useStore.getState().shuffleWorkspaces(mulberry32(7))
    expect(depth()).toBe(steps + 1)
    useStore.getState().undo()
    expect(useStore.getState().workspaces).toBe(order)

    useStore.getState().clearGridPhotos()
    expect(useStore.getState().workspaces.some(w => leafList(w.root).some(l => l.photoId))).toBe(false)
    useStore.getState().undo()
    expect(useStore.getState().workspaces.some(w => leafList(w.root).some(l => l.photoId))).toBe(true)
  })

  test('a no-op action pushes nothing', () => {
    const steps = depth()
    // Only one filled cell: shuffle has nothing to reorder.
    useStore.getState().shuffleWorkspaces(mulberry32(1))
    // Nothing to clear either.
    useStore.getState().clearGridPhotos()
    // An unknown pane has nothing to split.
    useStore.getState().split('nope', 'row')
    expect(depth()).toBe(steps)
  })
})

describe('history bounds', () => {
  test('an empty tree makes undo and redo no-ops', () => {
    const before = ws().root
    useStore.getState().undo()
    useStore.getState().redo()
    expect(ws().root).toBe(before)
    expect(stepCount(tree())).toBe(0)
    expect(canUndo(tree())).toBe(false)
    expect(canRedo(tree())).toBe(false)
  })

  test('the tree is capped: the oldest steps go first, the cursor path stays', () => {
    const base = ws().labels.length
    for (let i = 0; i < HISTORY_LIMIT + 5; i++)
      useStore.getState().addLabel(0.1, 0.1)
    expect(ws().labels).toHaveLength(base + HISTORY_LIMIT + 5)
    // Acting at a step that has children replaces them, so a session builds one
    // chain: the cap trims its oldest end, exactly as the linear stack did.
    expect(stepCount(tree())).toBe(HISTORY_LIMIT)
    expect(depth()).toBe(HISTORY_LIMIT - 1)
    const path = historyPath(tree())
    for (const id of path)
      expect(tree().nodes[id]).toBeDefined()

    // Undo walks back as far as the kept steps reach, and no further.
    for (let i = 0; i < HISTORY_LIMIT; i++)
      useStore.getState().undo()
    expect(depth()).toBe(0)
    expect(canUndo(tree())).toBe(false)
    // The oldest step kept is the board after the first five labels.
    expect(ws().labels).toHaveLength(base + 6)
    useStore.getState().undo()
    expect(ws().labels).toHaveLength(base + 6)
  })

  test('a new action replaces the branch behind the cursor', () => {
    useStore.getState().split(ws().focusId, 'row')
    const splitStep = tree().cursor!
    useStore.getState().addLabel(0.2, 0.2)
    const labelStep = tree().cursor!
    useStore.getState().undo()
    expect(ahead()).toBe(1)
    useStore.getState().addLabel(0.4, 0.4)
    // The step the undo left behind is gone, not a sibling of the new one.
    expect(tree().nodes[labelStep]).toBeUndefined()
    expect(tree().nodes[splitStep]!.children).toHaveLength(1)
    expect(ws().labels).toHaveLength(1)
    // Undo walks back to the split, redo returns into the replacement.
    useStore.getState().undo()
    expect(ws().labels).toHaveLength(0)
    expect(canRedo(tree())).toBe(true)
    useStore.getState().redo()
    expect(ws().labels).toHaveLength(1)
    // Nothing of the replaced step can be reached again: it is not a jump target.
    useStore.getState().jumpTo(labelStep)
    expect(tree().cursor).not.toBe(labelStep)
  })

  test('jumping to a step restores it exactly and records nothing', () => {
    useStore.getState().split(ws().focusId, 'row')
    const twoPane = ws().root
    const splitStep = tree().cursor!
    useStore.getState().addLabel(0.2, 0.2)
    const count = stepCount(tree())

    useStore.getState().jumpTo(splitStep)
    expect(ws().root).toBe(twoPane)
    expect(ws().labels).toHaveLength(0)
    expect(stepCount(tree())).toBe(count)
    expect(tree().cursor).toBe(splitStep)
    // redo walks back down into the branch the jump left.
    useStore.getState().redo()
    expect(ws().labels).toHaveLength(1)
  })

  test('resetHistory forgets the tree', () => {
    useStore.getState().split(ws().focusId, 'row')
    useStore.getState().undo()
    expect(ahead()).toBe(1)
    useStore.getState().resetHistory()
    expect(stepCount(tree())).toBe(0)
    expect(canUndo(tree())).toBe(false)
    expect(canRedo(tree())).toBe(false)
  })

  test('the stacks are session-only: persist never writes them', () => {
    useStore.getState().split(ws().focusId, 'row')
    expect(depth()).toBe(1)

    const raw = saved.get('collage:settings')
    expect(raw).toBeTruthy()
    const persisted = (JSON.parse(raw!) as { state: Record<string, unknown> }).state
    expect(persisted.history).toBeUndefined()
    expect(persisted.workspaces).toBeUndefined()
    // The visual settings it does save are still there.
    expect(persisted.gap).toBe(0)
  })
})

describe('pane rotation and flips', () => {
  const focusLeaf = () => leafList(ws().root)[0]!

  test('a rotation gesture is one undo step, and undo puts it back upright', () => {
    const id = focusLeaf().id
    if (!focusLeaf().photoId)
      useStore.getState().assign(id, 'ph-1')
    useStore.setState({ history: emptyHistory() })

    // The dial streams a reading per pointermove.
    for (const deg of [15, 30, 45])
      useStore.getState().rotatePane(id, degToRad(deg))
    expect(depth()).toBe(1)
    expect(radToDeg(rotationOf(focusLeaf()))).toBeCloseTo(45, 12)

    useStore.getState().undo()
    expect(rotationOf(focusLeaf())).toBe(0)
    useStore.getState().redo()
    expect(radToDeg(rotationOf(focusLeaf()))).toBeCloseTo(45, 12)
  })

  test('a separate gesture is a separate step once something else commits', () => {
    const id = focusLeaf().id
    if (!focusLeaf().photoId)
      useStore.getState().assign(id, 'ph-1')
    useStore.setState({ history: emptyHistory() })

    useStore.getState().rotatePane(id, degToRad(15))
    // A flip is its own action: untagged, so it breaks the coalescing window.
    useStore.getState().flipPane(id, 'y')
    useStore.getState().rotatePane(id, degToRad(30))
    expect(depth()).toBe(3)
    expect(focusLeaf().flipY).toBe(true)
  })

  test('a stepless angle is kept as set, not folded onto a lattice', () => {
    const id = focusLeaf().id
    if (!focusLeaf().photoId)
      useStore.getState().assign(id, 'ph-1')
    useStore.setState({ history: emptyHistory() })
    // The dial's drag is continuous: 23.7° is a value, not a rounding of 15/30.
    useStore.getState().rotatePane(id, degToRad(23.7))
    expect(radToDeg(rotationOf(focusLeaf()))).toBeCloseTo(23.7, 12)
    useStore.getState().rotatePane(id, degToRad(-46.3))
    expect(radToDeg(rotationOf(focusLeaf()))).toBeCloseTo(-46.3, 12)
  })

  test('the angle is wrapped, so a full turn reads as upright', () => {
    const id = focusLeaf().id
    useStore.getState().rotatePane(id, degToRad(370))
    expect(radToDeg(rotationOf(focusLeaf()))).toBeCloseTo(10, 12)
    useStore.getState().rotatePane(id, Math.PI * 2)
    expect(rotationOf(focusLeaf())).toBe(0)
    // A reading that changes nothing records no step.
    const steps = depth()
    useStore.getState().rotatePane(id, 0)
    expect(depth()).toBe(steps)
  })

  test('resetPaneRotation clears the turn and both mirrors in one step', () => {
    const id = focusLeaf().id
    useStore.setState({ history: emptyHistory() })
    useStore.getState().rotatePane(id, degToRad(90))
    useStore.getState().flipPane(id, 'x')
    useStore.getState().resetPaneRotation(id)
    expect(rotationOf(focusLeaf())).toBe(0)
    expect(focusLeaf().flipX).toBe(false)
    const steps = depth()
    // Nothing left to reset: a no-op records nothing.
    useStore.getState().resetPaneRotation(id)
    expect(depth()).toBe(steps)
  })

  test('framing travels with the photo: swap, copy and paste carry it', () => {
    const [a, b] = [focusLeaf().id, (() => {
      useStore.getState().split(focusLeaf().id, 'row')
      return leafList(ws().root)[1]!.id
    })()]
    useStore.getState().assign(a, 'ph-a')
    useStore.getState().assign(b, 'ph-b')
    useStore.getState().rotatePane(a, degToRad(90))
    useStore.getState().flipPane(a, 'x')

    useStore.getState().swapPhotos(a, b)
    const swapped = leafList(ws().root).find(l => l.id === b)!
    expect(radToDeg(rotationOf(swapped))).toBeCloseTo(90, 12)
    expect(swapped.flipX).toBe(true)

    useStore.getState().copyPane(b)
    useStore.getState().pastePane(a)
    const pasted = leafList(ws().root).find(l => l.id === a)!
    expect(radToDeg(rotationOf(pasted))).toBeCloseTo(90, 12)
    expect(pasted.flipX).toBe(true)
  })

  test('a fresh photo starts upright', () => {
    const id = focusLeaf().id
    useStore.getState().rotatePane(id, degToRad(90))
    useStore.getState().assign(id, 'ph-new')
    expect(rotationOf(focusLeaf())).toBe(0)
    expect(focusLeaf().flipX).toBeFalsy()
    expect(focusLeaf().flipY).toBeFalsy()
  })

  test('a filter is one untagged undo step, and clearing it is another', () => {
    const id = focusLeaf().id
    if (!focusLeaf().photoId)
      useStore.getState().assign(id, 'ph-1')
    useStore.setState({ history: emptyHistory() })
    useStore.getState().setPaneFilter(id, 'cyanotype')
    expect(focusLeaf().filter).toBe('cyanotype')
    expect(depth()).toBe(1)
    useStore.getState().setPaneFilter(id, 'print')
    expect(focusLeaf().filter).toBe('print')
    expect(depth()).toBe(2)
    // Same filter again: nothing changed, so nothing is recorded.
    useStore.getState().setPaneFilter(id, 'print')
    expect(depth()).toBe(2)
    useStore.getState().setPaneFilter(id, null)
    expect(focusLeaf().filter).toBeUndefined()
    expect(depth()).toBe(3)
    // One undo puts the filter back, in one step.
    useStore.getState().undo()
    expect(focusLeaf().filter).toBe('print')
    expect(depth()).toBe(2)
  })

  test('a filter travels with the photo: swap, copy, paste and duplicate', () => {
    const [a, b] = [focusLeaf().id, (() => {
      useStore.getState().split(focusLeaf().id, 'row')
      return leafList(ws().root)[1]!.id
    })()]
    useStore.getState().assign(a, 'ph-a')
    useStore.getState().assign(b, 'ph-b')
    useStore.getState().setPaneFilter(a, 'grain')

    useStore.getState().swapPhotos(a, b)
    expect(leafList(ws().root).find(l => l.id === b)!.filter).toBe('grain')
    expect(leafList(ws().root).find(l => l.id === a)!.filter).toBeUndefined()

    useStore.getState().copyPane(b)
    useStore.getState().pastePane(a)
    expect(leafList(ws().root).find(l => l.id === a)!.filter).toBe('grain')

    useStore.getState().duplicatePane(a, 'column')
    const copy = leafList(ws().root).find(l => l.id !== a && l.id !== b)!
    expect(copy.photoId).toBe('ph-a')
    expect(copy.filter).toBe('grain')
  })

  test('a new photo clears the filter, like the turn and the mirrors', () => {
    const id = focusLeaf().id
    useStore.getState().setPaneFilter(id, 'bitgrain')
    useStore.getState().assign(id, 'ph-new')
    expect(focusLeaf().filter).toBeUndefined()
  })
})

describe('grid groups (boards switched from the workspace switcher)', () => {
  const state = () => useStore.getState()
  /** How many steps undo can walk back through in this group's board. */
  const stepsOf = () => Math.max(0, historyPath(state().history).length - 1)

  test('a new group copies the open board: same photos, fresh ids, one undo step', () => {
    const firstId = state().activeGridId
    state().split(ws().focusId, 'row')
    state().assign(ws().focusId, 'photo-a')
    const before = ws()
    const beforeLeaves = leaves()
    beforeLeaves[0]!.stickers.push({ id: 'st1', photoId: 'photo-a', x: 0.5, y: 0.5, s: 0.2 })
    beforeLeaves[1]!.label = { id: 'lab1', text: 'L', font: '', theme: 'dark', x: 0.5, y: 0.5, size: 42, rot: 0 }

    const added = state().addGrid()
    expect(added).not.toBeNull()
    expect(state().grids.map(g => g.name)).toEqual(['1', '2'])
    expect(state().activeGridId).toBe(added!)
    // split + assign + the copy-carrying add: one step each.
    expect(stepsOf()).toBe(3)

    // The copy mirrors the board cell for cell, but nothing the store
    // addresses by id is shared.
    const copy = state().workspaces
    expect(copy).toHaveLength(state().parkedBoards[firstId]!.workspaces.length)
    const copyLeaves = leafList(copy[0]!.root)
    expect(copyLeaves).toHaveLength(beforeLeaves.length)
    expect(copyLeaves.map(l => l.photoId)).toEqual(beforeLeaves.map(l => l.photoId))
    const copyIds = new Set(copy.map(w => w.id))
    for (const w of state().parkedBoards[firstId]!.workspaces)
      expect(copyIds.has(w.id)).toBe(false)
    expect(copyLeaves.map(l => l.id)).not.toEqual(beforeLeaves.map(l => l.id))
    expect(copyLeaves[0]!.stickers.map(s => s.id)).not.toEqual(['st1'])
    expect(copyLeaves[1]!.label!.id).not.toBe('lab1')
    // The open board moved to the copy; the original parked whole.
    expect(state().parkedBoards[firstId]!.workspaces[0]!.root).toBe(before.root)

    // One undo removes the copied group and reopens the board it copied.
    state().undo()
    expect(state().grids).toHaveLength(1)
    expect(state().activeGridId).toBe(firstId)
    expect(state().parkedBoards).toEqual({})
    state().redo()
    expect(state().grids).toHaveLength(2)
    expect(state().activeGridId).toBe(added!)
  })

  test('switching groups is navigation: it pushes no undo entry', () => {
    const firstId = state().activeGridId
    const added = state().addGrid()!
    const steps = stepsOf()
    state().switchGrid(firstId)
    state().switchGrid(added)
    expect(stepsOf()).toBe(steps)
  })

  test('adding and renaming a group are one undo step each', () => {
    const firstId = state().activeGridId
    const added = state().addGrid()!
    expect(stepsOf()).toBe(1)
    state().renameGrid(added, 'Variant 2')
    expect(state().grids.map(g => g.name)).toEqual(['1', 'Variant 2'])
    expect(stepsOf()).toBe(2)

    state().undo()
    expect(state().grids.map(g => g.name)).toEqual(['1', '2'])
    // Undoing the add takes the group and its board away, and the view with it.
    state().undo()
    expect(state().grids).toHaveLength(1)
    expect(state().activeGridId).toBe(firstId)
    expect(state().parkedBoards).toEqual({})
    state().redo()
    expect(state().grids).toHaveLength(2)
  })

  test('a deleted group comes back with its board on undo', () => {
    const firstId = state().activeGridId
    const added = state().addGrid()!
    state().assign(ws().focusId, 'photo-b')
    const boardB = state().workspaces

    state().removeGrid(added)
    expect(state().grids.map(g => g.id)).toEqual([firstId])
    expect(state().activeGridId).toBe(firstId)
    expect(state().parkedBoards[added]).toBeUndefined()

    state().undo()
    expect(state().grids.map(g => g.id)).toEqual([firstId, added])
    // Undo reopens the group it removed, board and all (the snapshot was taken
    // while it was the open one), so its cells are back in view.
    expect(state().activeGridId).toBe(added)
    expect(boardOf(state(), added)).toBe(boardB)
    expect(leafList(boardOf(state(), added)[0]!.root).some(l => l.photoId)).toBe(true)
  })

  test('a no-op group action pushes nothing', () => {
    const steps = stepsOf()
    // One group: it can't be deleted, and an unknown id changes nothing.
    state().removeGrid(state().activeGridId)
    state().removeGrid('nope')
    state().renameGrid('nope', 'X')
    state().switchGrid(state().activeGridId)
    // A blank rename never counts.
    state().renameGrid(state().activeGridId, '  ')
    expect(stepsOf()).toBe(steps)
  })

  test('four groups is the cap', () => {
    for (let i = 0; i < MAX_GRIDS + 2; i++) {
      const added = state().addGrid()
      if (i < MAX_GRIDS - 1)
        expect(added).not.toBeNull()
      else
        expect(added).toBeNull()
    }
    expect(state().grids).toHaveLength(MAX_GRIDS)
    expect(stepsOf()).toBe(MAX_GRIDS - 1)
  })

  test('a legacy session (one board, no groups) hydrates as group 1', () => {
    const saved = Array.from({ length: 3 }, (_, i) => ({ ...state().workspaces[0]!, id: `legacy${i}` }))
    saved[1] = { ...saved[1]!, root: { ...saved[1]!.root, id: 'pane-1' } as typeof saved[1]['root'] }
    state().hydrate({
      meta: {
        workspaces: saved,
        activeId: 'legacy1',
        gap: 0,
        radius: 0,
        bg: '#000000',
        longSide: 2048,
        format: 'image/jpeg',
        quality: 0.92,
      },
      photos: [],
    })
    expect(state().grids).toHaveLength(1)
    expect(state().grids[0]!.name).toBe('1')
    expect(state().workspaces.map(w => w.id)).toEqual(['legacy0', 'legacy1', 'legacy2'])
    expect(state().activeId).toBe('legacy1')
    expect(state().parkedBoards).toEqual({})
    expect(stepsOf()).toBe(0)
  })

  test('a session with groups hydrates every board, open one first', () => {
    const cell = (id: string) => ({ ...state().workspaces[0]!, id })
    state().hydrate({
      meta: {
        grids: [
          { id: 'gA', name: 'Cover', workspaces: [cell('a0'), cell('a1')], activeId: 'a1' },
          { id: 'gB', name: 'Variant', workspaces: [cell('b0')], activeId: 'b0' },
        ],
        activeGridId: 'gB',
        workspaces: [cell('b0')],
        activeId: 'b0',
        gap: 0,
        radius: 0,
        bg: '#000000',
        longSide: 2048,
        format: 'image/jpeg',
        quality: 0.92,
      },
      photos: [],
    })
    expect(state().grids.map(g => g.name)).toEqual(['Cover', 'Variant'])
    expect(state().activeGridId).toBe('gB')
    expect(state().workspaces.map(w => w.id)).toEqual(['b0'])
    expect(state().parkedBoards.gA!.workspaces.map(w => w.id)).toEqual(['a0', 'a1'])
    expect(boardOf(state(), 'gA')).toBe(state().parkedBoards.gA!.workspaces)
  })
})

describe('sticker management (a library surface, outside the board history)', () => {
  const state = () => useStore.getState()

  /** A photo as a session before stickers had a kind would have saved it. */
  const legacyPhoto = (id: string) => ({
    id,
    name: `${id}.png`,
    file: new File([], `${id}.png`, { type: 'image/png' }),
    trueW: 64,
    trueH: 64,
    kind: undefined as 'photo' | 'sticker' | undefined,
    folder: undefined as string | undefined,
    orphaned: undefined as boolean | undefined,
  })

  /**
   * A session with a pane photo `p1`, which (unless `draw` is false) draws the
   * sticker `s1` both as a pane sticker and as a board sticker.
   */
  function hydrateWith(
    photos: ReturnType<typeof legacyPhoto>[],
    { meta = {}, draw = true }: { meta?: Record<string, unknown>, draw?: boolean } = {},
  ) {
    const cell = state().workspaces[0]!
    const marker = { id: 'st1', photoId: 's1', x: 0.5, y: 0.5, s: 0.2 }
    const root = {
      ...cell.root,
      type: 'leaf' as const,
      id: 'pane-1',
      photoId: 'p1',
      stickers: draw ? [marker] : [],
    }
    state().hydrate({
      meta: {
        workspaces: [{ ...cell, root, stickers: draw ? [{ ...marker, id: 'bst1' }] : [] }],
        activeId: cell.id,
        gap: 0,
        radius: 0,
        bg: '#000000',
        longSide: 2048,
        format: 'image/jpeg',
        quality: 0.92,
        ...meta,
      } as never,
      photos: photos as never,
    })
  }

  test('a legacy session lands every photo as a photo, and no folders', () => {
    hydrateWith([legacyPhoto('p1'), legacyPhoto('s1')])
    expect(state().photos.map(p => p.kind)).toEqual(['photo', 'photo'])
    expect(state().stickerFolders).toEqual([])
    expect(state().history.past).toHaveLength(0)
  })

  test('a saved folder list hydrates, and a retired asset nothing draws is collected', () => {
    hydrateWith(
      [
        { ...legacyPhoto('p1'), kind: 'sticker', folder: 'Faces' },
        { ...legacyPhoto('s1'), kind: 'sticker', orphaned: true },
        { ...legacyPhoto('gone'), kind: 'sticker', orphaned: true },
      ],
      { meta: { stickerFolders: ['Faces'] } },
    )
    expect(state().stickerFolders).toEqual(['Faces'])
    // s1 is still drawn by the pane and the board; `gone` is not drawn at all.
    expect(state().photos.map(p => [p.id, p.orphaned])).toEqual([['p1', undefined], ['s1', true]])
  })

  test('folder edits push no undo entry', () => {
    hydrateWith([legacyPhoto('p1')])
    const before = state().history.past.length
    expect(state().addStickerFolder('Faces')).toBe(true)
    expect(state().addStickerFolder('faces')).toBe(false)
    expect(state().addStickerFolder('   ')).toBe(false)
    expect(state().renameStickerFolder('Faces', 'Heads')).toBe(true)
    expect(state().renameStickerFolder('Nope', 'Heads')).toBe(false)
    state().deleteStickerFolder('Heads')
    expect(state().stickerFolders).toEqual([])
    expect(state().history.past).toHaveLength(before)
  })

  test('moving a sticker to a folder, and deleting an empty folder, repoints it', () => {
    hydrateWith([{ ...legacyPhoto('s1'), kind: 'sticker' }, legacyPhoto('p1')])
    state().addStickerFolder('Faces')
    state().moveStickerToFolder('s1', 'Faces')
    expect(state().photos.find(p => p.id === 's1')!.folder).toBe('Faces')
    state().deleteStickerFolder('Faces')
    expect(state().stickerFolders).toEqual([])
    expect(state().photos.find(p => p.id === 's1')!.folder).toBeUndefined()
  })

  test('a folder that does not exist is not a move target', () => {
    hydrateWith([{ ...legacyPhoto('s1'), kind: 'sticker' }])
    state().moveStickerToFolder('s1', 'Ghost')
    expect(state().photos.find(p => p.id === 's1')!.folder).toBeUndefined()
  })

  test('deleting a placed sticker keeps the asset, hidden, so the copies still draw', () => {
    hydrateWith([{ ...legacyPhoto('s1'), kind: 'sticker' }])
    state().deleteStickerAsset('s1')
    const kept = state().photos.find(p => p.id === 's1')
    expect(kept).toBeDefined()
    expect(kept!.orphaned).toBe(true)
    // The references themselves are untouched: whatever the boards draw, they
    // still draw, and the id still resolves through the photos map.
    const board = activeWs(state())
    const drawn = [...board.stickers, ...leafList(board.root).flatMap(l => l.stickers)]
    expect(drawn.some(s => s.photoId === 's1')).toBe(true)
    expect(state().photos.some(p => p.id === 's1')).toBe(true)
  })

  test('deleting an unused sticker drops it from the library', () => {
    hydrateWith([{ ...legacyPhoto('s1'), kind: 'sticker' }, legacyPhoto('p1')], { draw: false })
    state().deleteStickerAsset('s1')
    expect(state().photos.some(p => p.id === 's1')).toBe(false)
  })

  test('a reference only reachable through undo still counts as one', () => {
    hydrateWith([{ ...legacyPhoto('s1'), kind: 'sticker' }, legacyPhoto('p1')], { draw: false })
    // Drawing it (then handing the board back) leaves it in the undo stack, so
    // an undo could bring the pane that draws it back: the asset survives.
    state().addSticker('s1')
    state().undo()
    state().deleteStickerAsset('s1')
    expect(state().photos.find(p => p.id === 's1')?.orphaned).toBe(true)
    // With the history dropped there is nothing to restore, and the sweep at
    // hydration collects it.
    state().resetHistory()
    state().deleteStickerAsset('s1')
    expect(state().photos.some(p => p.id === 's1')).toBe(false)
  })

  test('a sticker is its own kind: the maker\'s import keeps the canvas ratio alone', () => {
    const added = state().addPhotos([new File([], 'made.png', { type: 'image/png' })], false, 'sticker')
    expect(added).toHaveLength(1)
    expect(state().photos.find(p => p.id === added[0]!.id)!.kind).toBe('sticker')
  })
})

describe('photo management (tags, usage, delete)', () => {
  const state = () => useStore.getState()

  /** A library photo as the import writes it (no tags, no EXIF). */
  const photo = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `${id}.jpg`,
    file: new File([], `${id}.jpg`, { type: 'image/jpeg' }),
    trueW: 64,
    trueH: 64,
    kind: 'photo' as const,
    ...extra,
  })

  /**
   * Hydrate a session whose first board draws `drawn` in a pane (and, when
   * `boardSticker` is set, that sticker id as a board-level sticker), which is
   * what makes an asset "used" for the retire rule.
   */
  function hydrateWith(
    photos: ReturnType<typeof photo>[],
    { meta = {}, drawn = 'p1' as string | null, boardSticker = null as string | null } = {},
  ) {
    const cell = state().workspaces[0]!
    const root = {
      ...cell.root,
      type: 'leaf' as const,
      id: 'pane-1',
      photoId: drawn,
      stickers: [],
    }
    state().hydrate({
      meta: {
        workspaces: [{ ...cell, root, stickers: boardSticker ? [{ id: 'bs1', photoId: boardSticker, x: 0.5, y: 0.5, s: 0.2 }] : [] }],
        activeId: cell.id,
        gap: 0,
        radius: 0,
        bg: '#000000',
        longSide: 2048,
        format: 'image/jpeg',
        quality: 0.92,
        ...meta,
      } as never,
      photos: photos as never,
    })
  }

  test('a legacy session hydrates with no tags at all', () => {
    const legacy = photo('p1')
    delete (legacy as { kind?: string }).kind
    hydrateWith([legacy, photo('p2')])
    expect(state().photoTags).toEqual([])
    expect(state().photos.every(p => p.tags === undefined)).toBe(true)
  })

  test('a saved tag list hydrates, and a lost tag comes back from the photos', () => {
    hydrateWith([photo('p1', { tags: ['Trip', 'Food'] }), photo('p2')], { meta: { photoTags: ['Trip'] } })
    expect(state().photoTags).toEqual(['Trip', 'Food'])
    expect(state().photos[0]!.tags).toEqual(['Trip', 'Food'])
  })

  test('tag edits push no undo entry', () => {
    hydrateWith([photo('p1'), photo('p2')])
    const before = state().history.past.length
    expect(state().addPhotoTag('Trip')).toBe(true)
    expect(state().addPhotoTag('trip')).toBe(false)
    expect(state().addPhotoTag('  ')).toBe(false)
    expect(state().renamePhotoTag('Trip', 'Journey')).toBe(true)
    expect(state().renamePhotoTag('Nope', 'Journey')).toBe(false)
    state().deletePhotoTag('Journey')
    expect(state().photoTags).toEqual([])
    expect(state().history.past).toHaveLength(before)
  })

  test('tagging a photo adds the tag to the list on the spot, in one spelling', () => {
    hydrateWith([photo('p1'), photo('p2')])
    state().tagPhoto('p1', 'Trip')
    expect(state().photoTags).toEqual(['Trip'])
    expect(state().photos[0]!.tags).toEqual(['Trip'])
    // A second photo typing the same tag in another case attaches to the first
    // spelling instead of inventing a second tag.
    state().tagPhoto('p2', ' trip ')
    expect(state().photoTags).toEqual(['Trip'])
    expect(state().photos[1]!.tags).toEqual(['Trip'])
    // A blank tag, or an unknown photo, changes nothing.
    state().tagPhoto('p2', '  ')
    state().tagPhoto('ghost', 'Food')
    expect(state().photoTags).toEqual(['Trip'])
    expect(state().photos[1]!.tags).toEqual(['Trip'])
  })

  test('untagging one photo leaves the tag in the list for the others', () => {
    hydrateWith([photo('p1', { tags: ['Trip'] }), photo('p2', { tags: ['Trip'] })], { meta: { photoTags: ['Trip'] } })
    state().untagPhoto('p1', 'Trip')
    expect(state().photos[0]!.tags).toBeUndefined()
    expect(state().photos[1]!.tags).toEqual(['Trip'])
    expect(state().photoTags).toEqual(['Trip'])
  })

  test('renaming a tag repoints every photo wearing it', () => {
    hydrateWith([photo('p1', { tags: ['Trip'] }), photo('p2')], { meta: { photoTags: ['Trip'] } })
    state().renamePhotoTag('Trip', 'Journey')
    expect(state().photoTags).toEqual(['Journey'])
    expect(state().photos[0]!.tags).toEqual(['Journey'])
    // Renaming to its own name in another case repoints too, not just the list.
    state().renamePhotoTag('Journey', 'journey')
    expect(state().photos[0]!.tags).toEqual(['journey'])
  })

  test('deleting a tag takes it off the photos and keeps them', () => {
    hydrateWith([photo('p1', { tags: ['Trip', 'Food'] }), photo('p2')], { meta: { photoTags: ['Trip', 'Food'] } })
    state().deletePhotoTag('Food')
    expect(state().photoTags).toEqual(['Trip'])
    expect(state().photos).toHaveLength(2)
    expect(state().photos[0]!.tags).toEqual(['Trip'])
  })

  test('deleting a photo a board draws keeps the record, hidden, so the pane still renders', () => {
    hydrateWith([photo('p1'), photo('p2')])
    state().deletePhotoAsset('p1')
    const kept = state().photos.find(p => p.id === 'p1')
    expect(kept).toBeDefined()
    expect(kept!.orphaned).toBe(true)
    // The pane still points at it, and the map the preview resolves it through
    // still holds the record (see photoAssetsOf hiding it from the lists).
    expect(leafList(ws().root)[0]!.photoId).toBe('p1')
  })

  test('deleting an unused photo drops it from the library', () => {
    hydrateWith([photo('p1'), photo('p2')])
    state().deletePhotoAsset('p2')
    expect(state().photos.some(p => p.id === 'p2')).toBe(false)
  })

  test('a photo whose last reference is a board sticker survives that sticker\'s delete', () => {
    hydrateWith([photo('p1'), photo('p2')], { boardSticker: 'p2' })
    state().deletePhotoAsset('p2')
    expect(state().photos.find(p => p.id === 'p2')?.orphaned).toBe(true)
  })

  test('the two delete actions stay on their own kind', () => {
    hydrateWith([photo('p1'), photo('p2', { kind: 'sticker' })])
    state().deletePhotoAsset('p2')
    expect(state().photos.find(p => p.id === 'p2')).toBeDefined()
    state().deleteStickerAsset('p1')
    expect(state().photos.find(p => p.id === 'p1')).toBeDefined()
  })

  test('the tag list goes with the library it labelled', () => {
    hydrateWith([photo('p1', { tags: ['Trip'] })], { meta: { photoTags: ['Trip'] } })
    state().clearLibrary()
    expect(state().photoTags).toEqual([])
  })
})
