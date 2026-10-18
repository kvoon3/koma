/**
 * Undo / redo as a tree of whole-state snapshots. Pure, so the store keeps the
 * tree in its own state and every transition here is unit-tested without one.
 *
 * A linear pair of stacks forgets the future the moment you act again. A tree
 * keeps it while you browse: undo moves the cursor to the parent step, redo
 * follows the branch you last walked, and the panel can jump to any step
 * (`components/HistoryPanel`).
 *
 * ## Acting from a step that has children
 *
 * A new action recorded at a step that already has children does NOT open a
 * second branch: it REPLACES the child the cursor last visited (the step redo
 * would have walked into) together with everything below it, and the new
 * action takes its place. A replaced branch is destroyed for good: that is
 * the product's chosen trade for one clean main line instead of a bush of
 * near-identical variants. A sibling that was never on the active line is not
 * touched, so a tree that already has a fork keeps it.
 *
 * A snapshot is a shallow view of the undoable slices (the workspace array, its
 * objects and the background are all replaced, never mutated, by the store's
 * actions), so a step costs a handful of references: the 400 that fit stay well
 * under a kilobyte of bookkeeping.
 *
 * ## Where a step's snapshot comes from
 *
 * The store commits *before* the mutation (`commit()` captures the state the
 * action is about to change), so the snapshot a commit carries is the state at
 * the step it leaves, not the one it opens. Each node therefore holds the state
 * AT that node ("the board as it stood when the cursor was here"), and the node
 * a commit opens starts out holding its parent's state: the provisional tail.
 * It is settled the moment the cursor leaves it: the next commit, an undo, a
 * redo or a jump hands over the live snapshot, and no other transition ever
 * reads it. So `stepUp` restores a state that is always exact, and the tail is
 * the only node that is briefly stale.
 */

/** Steps a session keeps, root included; older leaves are pruned (see `prune`). */
export const HISTORY_LIMIT = 400

/**
 * A drag emits a stream of mutations (every pointermove, every wheel tick).
 * Commits of the same streaming tag inside this window collapse into the step
 * the gesture opened, so one gesture is one undo step.
 */
export const COALESCE_MS = 600

/** One step: a board state, the step before it, and the steps that follow it. */
export interface HistoryNode<T> {
  /** The board at this step (see the tail note above: the cursor's copy settles late). */
  snapshot: T
  /** The step this one was recorded from; null for the root. */
  parent: string | null
  /** Steps recorded from this one, in recording order. */
  children: string[]
  /** The child the cursor last stood in: what redo walks back down into. */
  lastVisitedChild: string | null
  /** The tag of the action that opened this step ('start' for the root). */
  label: string | null
  /** When the step was recorded (ms): the coalescing window and the panel's clock. */
  at: number
}

export interface History<T> {
  nodes: Record<string, HistoryNode<T>>
  /** The anchor of the tree: the board as the session started. Null until the first commit. */
  root: string | null
  /** The step the board is at. Null until the first commit. */
  cursor: string | null
  /** Monotonic id source: `s1`, `s2`, … so a tree is reproducible from its inputs. */
  seq: number
}

export function emptyHistory<T>(): History<T> {
  return { nodes: {}, root: null, cursor: null, seq: 0 }
}

/** The root step's label: the board before the session's first action. */
const START = 'start'

/**
 * Gesture tags that do not spell their target after a colon. Every other
 * streaming tag does (`rotatePane:p3`), which is what tells a gesture's stream
 * of commits from two quick clicks on a discrete action: only gestures
 * coalesce, so pressing split twice in half a second stays two undo steps.
 */
const GESTURE_TAGS = new Set(['setCanvasSize'])

/** Is this tag a gesture's stream of commits (one step per gesture)? */
export function isGestureTag(tag: string): boolean {
  return tag.includes(':') || GESTURE_TAGS.has(tag)
}

/** The id `seq` steps in, as a number (ids are `s<seq>`). */
const seqOf = (id: string): number => Number(id.slice(1))

/** A fresh node, wired to `parent` and made the cursor. */
function addNode<T>(
  history: History<T>,
  parent: string | null,
  snapshot: T,
  label: string | null,
  at: number,
): History<T> {
  const id = `s${history.seq + 1}`
  const nodes: Record<string, HistoryNode<T>> = {
    ...history.nodes,
    [id]: { snapshot, parent, children: [], lastVisitedChild: null, label, at },
  }
  if (parent != null) {
    const node = nodes[parent]
    if (node) {
      // Recording a child is a visit: redo from here returns into it.
      nodes[parent] = { ...node, children: [...node.children, id], lastVisitedChild: id }
    }
  }
  return { nodes, root: history.root ?? id, cursor: id, seq: history.seq + 1 }
}

/** `id` and every step above it, bottom-up. Missing nodes stop the walk. */
function lineage<T>(history: History<T>, id: string | null): string[] {
  const out: string[] = []
  let cur = id
  while (cur != null && history.nodes[cur]) {
    out.push(cur)
    cur = history.nodes[cur]!.parent
  }
  return out
}

/** Detach one step from its parent, and point the parent's way back down at a step that is left. */
function unlink<T>(nodes: Record<string, HistoryNode<T>>, id: string): Record<string, HistoryNode<T>> {
  const node = nodes[id]
  const parent = node?.parent == null ? undefined : nodes[node.parent]
  if (!node || !parent)
    return nodes
  const children = parent.children.filter(c => c !== id)
  return {
    ...nodes,
    [node.parent!]: {
      ...parent,
      children,
      lastVisitedChild: parent.lastVisitedChild === id ? (children.at(-1) ?? null) : parent.lastVisitedChild,
    },
  }
}

/** Drop one leaf: a step with nothing below it. */
function dropLeaf<T>(nodes: Record<string, HistoryNode<T>>, id: string): Record<string, HistoryNode<T>> {
  const next = unlink(nodes, id)
  delete next[id]
  return next
}

/**
 * Drop a step and its whole subtree (the overwrite rule's casualty). The walk is
 * iterative: a branch left over from a long session can be hundreds deep.
 */
function dropSubtree<T>(nodes: Record<string, HistoryNode<T>>, id: string): Record<string, HistoryNode<T>> {
  if (!nodes[id])
    return nodes
  const next = unlink(nodes, id)
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    const node = next[cur]
    if (!node)
      continue
    stack.push(...node.children)
    delete next[cur]
  }
  return next
}

/**
 * Drop the oldest leaves until the tree fits `limit` again. Leaves first, and
 * never a step on the cursor's path: the branch you are standing on is what
 * undo reaches, so it outlives everything else.
 *
 * A tree that is nothing but the cursor's path (the shape every session takes
 * now that acting overwrites, see the header) has no leaf off the path to drop,
 * so it shrinks the other way instead: the ROOT goes, and the step below it
 * becomes the new root. That is the old linear stack's rule (forget the oldest
 * first) and it keeps the node count bounded whatever the shape.
 */
function prune<T>(history: History<T>, limit: number): History<T> {
  let nodes = history.nodes
  let root = history.root
  let count = Object.keys(nodes).length
  if (count <= limit)
    return history
  const byAge = Object.keys(nodes).sort((a, b) => seqOf(a) - seqOf(b))
  while (count > limit) {
    const keep = new Set(lineage({ ...history, nodes, root }, history.cursor))
    // Dropping a leaf can make its parent one, so the sweep runs again: a pass
    // that frees nothing means only the cursor's path is left.
    let victim: string | null = null
    for (const id of byAge) {
      const node = nodes[id]
      if (node && node.parent != null && node.children.length === 0 && !keep.has(id)) {
        victim = id
        break
      }
    }
    if (victim != null) {
      nodes = dropLeaf(nodes, victim)
      count--
      continue
    }
    // A pure chain: forget the oldest step of it, root and all, so the walk
    // above always has a step left to stand on.
    const oldest = lineage({ ...history, nodes, root }, history.cursor).at(-1)
    const heir = oldest == null ? undefined : nodes[oldest]?.children.find(c => nodes[c])
    if (oldest == null || heir == null) {
      break
    }
    const next = { ...nodes }
    delete next[oldest]
    next[heir] = { ...next[heir]!, parent: null }
    nodes = next
    root = heir
    count--
  }
  return { ...history, nodes, root }
}

/**
 * Record `snapshot`: the board as it stands right before the mutation about to
 * run. The step it opens hangs off the cursor; if the cursor already has a step
 * below it, that step (and its subtree) is replaced, see the header. A commit
 * continuing the same gesture keeps the step the gesture opened instead, so
 * undo returns to before the gesture began.
 */
export function record<T>(
  history: History<T>,
  snapshot: T,
  now = Date.now(),
  tag: string | null = null,
  limit = HISTORY_LIMIT,
): History<T> {
  const cursor = history.cursor
  const node = cursor == null ? undefined : history.nodes[cursor]
  if (cursor == null || !node) {
    // The first commit opens the tree: what it carries is the board before
    // anything happened, so it is the root, and the action in flight is its
    // first child.
    const rooted = addNode(history, null, snapshot, START, now)
    return prune(addNode(rooted, rooted.cursor, snapshot, tag, now), limit)
  }
  if (tag != null && isGestureTag(tag) && node.label === tag && now - node.at < COALESCE_MS) {
    // Same gesture: the step it opened is the one undo should reach, so only
    // its clock moves.
    return { ...history, nodes: { ...history.nodes, [cursor]: { ...node, at: now } } }
  }
  // Settle the step we are leaving with the board as it is now (see the tail
  // note above), then hang the new step off it, replacing the line the cursor
  // would have redone into if there is one.
  const settled: History<T> = { ...history, nodes: { ...history.nodes, [cursor]: { ...node, snapshot } } }
  const replaced = node.lastVisitedChild ?? node.children.at(-1) ?? null
  const trimmed: History<T> = replaced == null
    ? settled
    : { ...settled, nodes: dropSubtree(settled.nodes, replaced) }
  return prune(addNode(trimmed, cursor, snapshot, tag, now), limit)
}

export interface Step<T> {
  history: History<T>
  snapshot: T
}

/**
 * Step back to the parent (⌘Z). `current` is the live board, which settles the
 * step being left so redo can return to it. Null at the root.
 */
export function stepUp<T>(history: History<T>, current: T): Step<T> | null {
  const cursor = history.cursor
  const node = cursor == null ? undefined : history.nodes[cursor]
  if (cursor == null || !node || node.parent == null)
    return null
  const parent = history.nodes[node.parent]
  if (!parent)
    return null
  const nodes = {
    ...history.nodes,
    [cursor]: { ...node, snapshot: current },
    // Leaving into the parent is a visit: redo walks back into the step we
    // just left, not into whichever branch happened to be newest.
    [node.parent]: { ...parent, lastVisitedChild: cursor },
  }
  return { history: { ...history, nodes, cursor: node.parent }, snapshot: parent.snapshot }
}

/**
 * Step forward into the child visited last (⇧⌘Z), falling back to the newest
 * child when a step was never walked into. Null at a leaf.
 */
export function stepDown<T>(history: History<T>, current: T): Step<T> | null {
  const cursor = history.cursor
  const node = cursor == null ? undefined : history.nodes[cursor]
  if (cursor == null || !node)
    return null
  const remembered = node.lastVisitedChild == null ? undefined : history.nodes[node.lastVisitedChild]
  const childId = remembered ? node.lastVisitedChild! : node.children.at(-1)
  const child = childId == null ? undefined : history.nodes[childId]
  if (childId == null || !child)
    return null
  const nodes = { ...history.nodes, [cursor]: { ...node, snapshot: current, lastVisitedChild: childId } }
  return { history: { ...history, nodes, cursor: childId }, snapshot: child.snapshot }
}

/**
 * Jump to any step (the history panel's rows). `current` settles the step being
 * left, and the whole chain up to the target records the visit, so redo follows
 * the branch the jump walked. Null for an unknown id or the cursor itself.
 */
export function jump<T>(history: History<T>, id: string, current: T): Step<T> | null {
  const cursor = history.cursor
  const node = cursor == null ? undefined : history.nodes[cursor]
  const target = history.nodes[id]
  if (cursor == null || !node || !target || id === cursor)
    return null
  const nodes: Record<string, HistoryNode<T>> = { ...history.nodes, [cursor]: { ...node, snapshot: current } }
  // Bottom-up, so every step on the path to the target remembers which way the
  // jump went: redo from any of them returns along this branch.
  let child: string | null = id
  while (child != null) {
    const step: HistoryNode<T> | undefined = nodes[child]
    const parentId: string | null = step ? step.parent : null
    const parent: HistoryNode<T> | undefined = parentId == null ? undefined : nodes[parentId]
    if (!parent || parentId == null)
      break
    nodes[parentId] = { ...parent, lastVisitedChild: child }
    child = parentId
  }
  return { history: { ...history, nodes, cursor: id }, snapshot: target.snapshot }
}

/** Is there a step above the cursor (⌘Z)? */
export function canUndo<T>(history: History<T>): boolean {
  const node = history.cursor == null ? undefined : history.nodes[history.cursor]
  return node != null && node.parent != null
}

/** Is there a step below the cursor (⇧⌘Z)? */
export function canRedo<T>(history: History<T>): boolean {
  const node = history.cursor == null ? undefined : history.nodes[history.cursor]
  return node != null && node.children.length > 0
}

/** The steps from the root down to the cursor: the list the panel draws. */
export function historyPath<T>(history: History<T>): string[] {
  return lineage(history, history.cursor).reverse()
}

/** Every step as panel rows would want them, oldest first. */
export function stepCount<T>(history: History<T>): number {
  return Object.keys(history.nodes).length
}

/**
 * The English label of a step, keyed by the tag its action committed. The panel
 * translates it (`t(historyLabel(tag))`), so these strings are also the i18n
 * keys; a tag nobody taught us falls back to its own words, never to nothing.
 */
const LABELS: Record<string, string> = {
  start: 'Start',
  // pane tree
  split: 'Split pane',
  duplicatePane: 'Duplicate pane',
  closePane: 'Close pane',
  deletePane: 'Delete pane',
  closeOtherPanes: 'Close other panes',
  closeEmptyPanes: 'Close empty panes',
  resetPane: 'Reset pane',
  pastePane: 'Paste pane',
  swapPhotos: 'Swap panes',
  resizeSplit: 'Resize panes',
  updateLeaf: 'Pan the photo',
  // the photo in a pane
  assign: 'Place photo',
  assignMany: 'Place photos',
  autoFill: 'Fill empty panes',
  removePhoto: 'Remove photo',
  rotatePane: 'Rotate photo',
  flipPane: 'Flip photo',
  resetPaneRotation: 'Straighten photo',
  setPaneFilter: 'Filter photo',
  // stickers and board text
  addSticker: 'Add sticker',
  removeSticker: 'Remove sticker',
  moveSticker: 'Move sticker',
  scaleSticker: 'Scale sticker',
  rotateSticker: 'Rotate sticker',
  addLabel: 'Add text',
  removeLabel: 'Remove text',
  setLabel: 'Edit text',
  // the board
  setCanvasSize: 'Canvas ratio',
  resetWorkspace: 'Reset workspace',
  resetAllWorkspaces: 'Reset every workspace',
  addWorkspace: 'Add workspace',
  removeWorkspace: 'Delete workspace',
  moveWorkspace: 'Move workspace',
  shuffleWorkspaces: 'Shuffle workspaces',
  clearGridPhotos: 'Clear photos',
  addGrid: 'New workspace',
  removeGrid: 'Delete workspace',
  renameGrid: 'Rename workspace',
  // generic
  patch: 'Board look',
  edit: 'Edit',
}

/** What one `patch:*` key is about, so the board-look label is not always the same. */
const PATCH_LABELS: Record<string, string> = {
  bg: 'Background',
  bgGradient: 'Background',
  bgImage: 'Background',
  gap: 'Photo gap',
  radius: 'Photo corners',
  edgeFade: 'Blend',
  edgeFadeStrength: 'Blend',
  gridGap: 'Grid gap',
  grids: 'Workspace list',
  parkedBoards: 'Workspace list',
  workspaces: 'Board',
}

/** `camelCase` → `Camel case`: the fallback for a tag with no label of its own. */
function humanize(tag: string): string {
  const words = tag
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  return words === '' ? 'Edit' : words[0]!.toUpperCase() + words.slice(1)
}

/** The English label (i18n key) of the step a tag opened. */
export function historyLabel(tag: string | null): string {
  if (tag == null)
    return LABELS.edit!
  const [base, rest] = tag.split(/:(.*)/s) as [string, string?]
  if (base === 'patch' && rest) {
    for (const key of rest.split(',')) {
      const label = PATCH_LABELS[key]
      if (label)
        return label
    }
  }
  return LABELS[base] ?? humanize(base)
}

/** How long ago a step was recorded, for the panel's clock. */
export type StepAge = 'now' | { unit: 's' | 'm' | 'h', n: number }

export function stepAge(at: number, now: number): StepAge {
  const seconds = Math.floor((now - at) / 1000)
  if (seconds < 1)
    return 'now'
  if (seconds < 60)
    return { unit: 's', n: seconds }
  if (seconds < 3600)
    return { unit: 'm', n: Math.floor(seconds / 60) }
  return { unit: 'h', n: Math.floor(seconds / 3600) }
}
