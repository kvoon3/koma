/// <reference types="bun" />
import { beforeEach, describe, expect, test } from 'bun:test'
import { degToRad, radToDeg } from './lib/detent'
import { mulberry32 } from './lib/gridTools'
import { emptyHistory, HISTORY_LIMIT } from './lib/history'
import { leafList, rotationOf } from './lib/panes'

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

const { activeWs, useStore } = await import('./store')

/** The store as it booted: each test starts from a blank board and no history. */
const boot = useStore.getState()

beforeEach(() => {
  useStore.setState({ ...boot, history: emptyHistory() })
})

const ws = () => activeWs(useStore.getState())
const leaves = () => leafList(ws().root)

describe('undo / redo over the pane tree', () => {
  test('a split is undone back to the exact tree and redone', () => {
    const before = ws().root
    expect(leaves()).toHaveLength(1)

    useStore.getState().split(ws().focusId, 'row')
    expect(leaves()).toHaveLength(2)
    const split = ws().root
    expect(useStore.getState().history.past).toHaveLength(1)

    useStore.getState().undo()
    expect(leaves()).toHaveLength(1)
    // The restored tree is the very object the split started from.
    expect(ws().root).toBe(before)
    expect(useStore.getState().history.future).toHaveLength(1)

    useStore.getState().redo()
    expect(useStore.getState().history.past).toHaveLength(1)
    expect(ws().root).toBe(split)
    expect(useStore.getState().history.future).toHaveLength(0)
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
    expect(useStore.getState().history.past).toHaveLength(2)
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
    const depth = useStore.getState().history.past.length
    useStore.getState().patch({ gap: 40, radius: 12, activeId: ws().id })
    expect(useStore.getState().history.past).toHaveLength(depth)
  })

  test('dragging the background colour is one undo step', () => {
    const depth = useStore.getState().history.past.length
    for (const bg of ['#111111', '#222222', '#333333'])
      useStore.getState().patch({ bg })
    expect(useStore.getState().history.past).toHaveLength(depth + 1)
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
    const depth = useStore.getState().history.past.length
    useStore.getState().shuffleWorkspaces(mulberry32(7))
    expect(useStore.getState().history.past).toHaveLength(depth + 1)
    useStore.getState().undo()
    expect(useStore.getState().workspaces).toBe(order)

    useStore.getState().clearGridPhotos()
    expect(useStore.getState().workspaces.some(w => leafList(w.root).some(l => l.photoId))).toBe(false)
    useStore.getState().undo()
    expect(useStore.getState().workspaces.some(w => leafList(w.root).some(l => l.photoId))).toBe(true)
  })

  test('a no-op action pushes nothing', () => {
    const depth = useStore.getState().history.past.length
    // Only one filled cell: shuffle has nothing to reorder.
    useStore.getState().shuffleWorkspaces(mulberry32(1))
    // Nothing to clear either.
    useStore.getState().clearGridPhotos()
    // An unknown pane has nothing to split.
    useStore.getState().split('nope', 'row')
    expect(useStore.getState().history.past).toHaveLength(depth)
  })
})

describe('history bounds', () => {
  test('an empty stack makes undo and redo no-ops', () => {
    const before = ws().root
    useStore.getState().undo()
    useStore.getState().redo()
    expect(ws().root).toBe(before)
    expect(useStore.getState().history.past).toHaveLength(0)
    expect(useStore.getState().history.future).toHaveLength(0)
  })

  test('the stack is capped, and the oldest steps are forgotten', () => {
    const base = ws().labels.length
    for (let i = 0; i < HISTORY_LIMIT + 5; i++)
      useStore.getState().addLabel(0.1, 0.1)
    expect(useStore.getState().history.past).toHaveLength(HISTORY_LIMIT)
    expect(ws().labels).toHaveLength(base + HISTORY_LIMIT + 5)

    // Every kept step can be undone, and no further one can.
    for (let i = 0; i < HISTORY_LIMIT; i++)
      useStore.getState().undo()
    expect(useStore.getState().history.past).toHaveLength(0)
    expect(ws().labels).toHaveLength(base + 5)
    useStore.getState().undo()
    expect(ws().labels).toHaveLength(base + 5)
  })

  test('a new action drops the redo path', () => {
    useStore.getState().split(ws().focusId, 'row')
    useStore.getState().undo()
    expect(useStore.getState().history.future).toHaveLength(1)
    useStore.getState().addLabel(0.2, 0.2)
    expect(useStore.getState().history.future).toHaveLength(0)
    useStore.getState().redo()
    expect(ws().labels).toHaveLength(1)
  })

  test('resetHistory forgets both stacks', () => {
    useStore.getState().split(ws().focusId, 'row')
    useStore.getState().undo()
    useStore.getState().resetHistory()
    expect(useStore.getState().history.past).toHaveLength(0)
    expect(useStore.getState().history.future).toHaveLength(0)
  })

  test('the stacks are session-only: persist never writes them', () => {
    useStore.getState().split(ws().focusId, 'row')
    expect(useStore.getState().history.past).toHaveLength(1)

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
    expect(useStore.getState().history.past).toHaveLength(1)
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
    expect(useStore.getState().history.past).toHaveLength(3)
    expect(focusLeaf().flipY).toBe(true)
  })

  test('the angle is wrapped, so a full turn reads as upright', () => {
    const id = focusLeaf().id
    useStore.getState().rotatePane(id, degToRad(370))
    expect(radToDeg(rotationOf(focusLeaf()))).toBeCloseTo(10, 12)
    useStore.getState().rotatePane(id, Math.PI * 2)
    expect(rotationOf(focusLeaf())).toBe(0)
    // A reading that changes nothing records no step.
    const depth = useStore.getState().history.past.length
    useStore.getState().rotatePane(id, 0)
    expect(useStore.getState().history.past).toHaveLength(depth)
  })

  test('resetPaneRotation clears the turn and both mirrors in one step', () => {
    const id = focusLeaf().id
    useStore.setState({ history: emptyHistory() })
    useStore.getState().rotatePane(id, degToRad(90))
    useStore.getState().flipPane(id, 'x')
    useStore.getState().resetPaneRotation(id)
    expect(rotationOf(focusLeaf())).toBe(0)
    expect(focusLeaf().flipX).toBe(false)
    const depth = useStore.getState().history.past.length
    // Nothing left to reset: a no-op records nothing.
    useStore.getState().resetPaneRotation(id)
    expect(useStore.getState().history.past).toHaveLength(depth)
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
})
