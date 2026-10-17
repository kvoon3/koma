/**
 * Pure rules for the workspace grid (the overview): how many cells each board
 * holds, how adding, removing and restoring them behave, and how the boards
 * themselves (grid groups: two 3×3 grids side by side, A vs B) are added,
 * renamed, removed and compared. Generic over the workspace shape so they test
 * without the store.
 */

/** A board never drops below one cell: the editor always needs a workspace. */
export const MIN_WORKSPACES = 1
/** 3×3 is the most the grid shows; at nine the + cell hides. */
export const MAX_WORKSPACES = 9
/** A fresh board: eight cells, the ninth position is the + button. */
export const DEFAULT_WORKSPACES = 8

/** Append a fresh cell at the end; a full board is returned untouched. */
export function addSlot<T>(list: T[], fresh: () => T): T[] {
  return list.length >= MAX_WORKSPACES ? list : [...list, fresh()]
}

/**
 * Remove a cell; the rest close up in order (the 3-column grid reflows). The
 * last remaining cell can't go, so it is reset to a fresh one in place (same
 * id). An unknown id returns the list untouched.
 */
export function removeSlot<T extends { id: string }>(list: T[], id: string, fresh: () => T): T[] {
  if (!list.some(w => w.id === id))
    return list
  if (list.length <= MIN_WORKSPACES)
    return list.map(w => (w.id === id ? { ...fresh(), id } : w))
  return list.filter(w => w.id !== id)
}

/** Reset one cell to a fresh one in its own slot (same id and position). */
export function resetSlot<T extends { id: string }>(list: T[], id: string, fresh: () => T): T[] {
  if (!list.some(w => w.id === id))
    return list
  return list.map(w => (w.id === id ? { ...fresh(), id } : w))
}

/**
 * Bring a saved board (session autosave or a .koma.json) within bounds. Old
 * saves always held exactly nine cells; they keep every cell (nine fits the
 * new max, so + simply stays hidden until one is removed). Missing or empty
 * lists get the default board; anything past nine is dropped; duplicate ids
 * keep the first.
 */
export function normalizeSlots<T extends { id: string }>(list: T[] | null | undefined, fresh: () => T): T[] {
  const seen = new Set<string>()
  const out = (list ?? []).filter((w) => {
    if (!w || typeof w.id !== 'string' || seen.has(w.id))
      return false
    seen.add(w.id)
    return true
  }).slice(0, MAX_WORKSPACES)
  return out.length ? out : Array.from({ length: DEFAULT_WORKSPACES }, fresh)
}

/** Which id stays active after a removal: the same one, else its new neighbor. */
export function activeAfterRemove<T extends { id: string }>(before: T[], after: T[], activeId: string): string {
  if (after.some(w => w.id === activeId))
    return activeId
  const i = Math.max(0, before.findIndex(w => w.id === activeId))
  return after[Math.min(i, after.length - 1)].id
}

/**
 * A board is one group of nine cells. The overview keeps a handful of them so
 * two arrangements can be built and compared side by side; past four the
 * group bar stops earning its row.
 */
export const MAX_GRIDS = 4
/** One board always stays: the app needs somewhere to edit. */
export const MIN_GRIDS = 1
/** Default group names, in add order (the user renames them). */
export const GRID_NAMES = ['A', 'B', 'C', 'D'] as const

/** A board's identity in the group bar: its id and the name the chip shows. */
export interface GridGroup {
  id: string
  name: string
}

/**
 * The board of a group that is not open. The open group's board is the store's
 * `workspaces`, so that every existing action (and every consumer of the
 * active workspace) keeps working on "the board in view" without knowing
 * groups exist; switching groups is a swap between the two.
 */
export interface ParkedBoard<T> {
  workspaces: T[]
  /** The cell last edited in this group, restored when it is opened again. */
  activeId: string
}

/** One group of a saved session: its cells and the cell last edited there. */
export interface SavedGrid<T> {
  id: string
  name?: string
  workspaces?: readonly T[] | null
  activeId?: string | null
}

/** Everything a session (or a board file) hands the store when a board loads. */
export interface SavedGrids<T> {
  /** Groups, written by a session saved after the dual grid. */
  grids?: readonly (SavedGrid<T> | null | undefined)[] | null
  /** The single board older sessions saved, before groups existed. */
  workspaces?: readonly T[] | null
  /** The group that was open. */
  activeGridId?: string | null
  activeId?: string | null
}

/** The store's group state, hydrated: the open board plus the parked ones. */
export interface GridsState<T> {
  grids: GridGroup[]
  activeGridId: string
  workspaces: T[]
  activeId: string
  parked: Record<string, ParkedBoard<T>>
}

/** The next default name: the first letter the bar has not taken. */
export function nextGridName(groups: readonly GridGroup[]): string {
  const used = new Set(groups.map(g => g.name))
  return GRID_NAMES.find(name => !used.has(name)) ?? `G${groups.length + 1}`
}

/** Append a group; a full bar is returned untouched. */
export function addGroup(groups: GridGroup[], fresh: () => GridGroup): GridGroup[] {
  return groups.length >= MAX_GRIDS ? groups : [...groups, fresh()]
}

/** Drop a group; the last one stays, so there is always a board to edit. */
export function removeGroup(groups: GridGroup[], id: string): GridGroup[] {
  if (groups.length <= MIN_GRIDS)
    return groups
  const next = groups.filter(g => g.id !== id)
  return next.length === groups.length ? groups : next
}

/** Rename a group; a blank name, or the one it already has, changes nothing. */
export function renameGroup(groups: GridGroup[], id: string, name: string): GridGroup[] {
  const clean = name.trim()
  if (!clean || !groups.some(g => g.id === id && g.name !== clean))
    return groups
  return groups.map(g => (g.id === id ? { ...g, name: clean } : g))
}

/**
 * The two groups a compare view shows: the picks that still exist, else the
 * first two. Null while the board holds fewer than two groups.
 */
export function comparePair(groups: readonly GridGroup[], a: string | null, b: string | null): [GridGroup, GridGroup] | null {
  const first = groups.find(g => g.id === a) ?? groups[0]
  const second = first ? groups.find(g => g.id === b && g.id !== first.id) ?? groups.find(g => g.id !== first.id) : undefined
  return first && second ? [first, second] : null
}

/** One group as a session wrote it, before the ids and names are checked. */
interface SavedEntry<T> {
  id: string
  name: string
  workspaces: readonly T[] | null | undefined
  activeId: string | null | undefined
}

/**
 * The saved groups as entries within the cap (fresh ids for the missing or
 * duplicate ones), or a single entry for a board saved before groups existed.
 */
function savedEntries<T extends { id: string }>(saved: SavedGrids<T>, newGridId: () => string): SavedEntry<T>[] {
  const seen = new Set<string>()
  const entries: SavedEntry<T>[] = []
  for (const g of saved.grids ?? []) {
    if (entries.length >= MAX_GRIDS)
      break
    if (!g)
      continue
    const id = typeof g.id === 'string' && g.id && !seen.has(g.id) ? g.id : newGridId()
    if (seen.has(id))
      continue
    seen.add(id)
    entries.push({ id, name: typeof g.name === 'string' ? g.name.trim() : '', workspaces: g.workspaces, activeId: g.activeId })
  }
  if (!entries.length)
    entries.push({ id: newGridId(), name: '', workspaces: saved.workspaces, activeId: saved.activeId })
  return entries
}

/**
 * Bring a saved board within the group model: groups past the cap are dropped,
 * missing or duplicate ids get a fresh one, a nameless group takes the next
 * default name, and each board is within 1–9 cells (see normalizeSlots).
 *
 * A session saved before groups held exactly one board and no group list: that
 * board becomes group A, so a refresh after this change lands on the board the
 * user left, with every cell intact.
 */
export function normalizeGrids<T extends { id: string }>(
  saved: SavedGrids<T>,
  fresh: () => T,
  newGridId: () => string,
): GridsState<T> {
  const entries = savedEntries(saved, newGridId)
  const grids: GridGroup[] = []
  const boards = entries.map((entry) => {
    const group = { id: entry.id, name: entry.name || nextGridName(grids) }
    grids.push(group)
    const workspaces = normalizeSlots(entry.workspaces as T[] | null | undefined, fresh)
    const activeId = workspaces.some(w => w.id === entry.activeId) ? entry.activeId as string : workspaces[0].id
    return { group, workspaces, activeId }
  })

  // The group that was open keeps the view; anything unknown opens the first.
  const open = Math.max(0, boards.findIndex(b => b.group.id === saved.activeGridId))
  const active = boards[open]
  const parked: Record<string, ParkedBoard<T>> = {}
  for (const board of boards) {
    if (board !== active)
      parked[board.group.id] = { workspaces: board.workspaces, activeId: board.activeId }
  }
  return { grids, activeGridId: active.group.id, workspaces: active.workspaces, activeId: active.activeId, parked }
}

export type GridDir = 'left' | 'right' | 'up' | 'down' | 'next'

/**
 * Keyboard step over `n` cells laid out three to a row (the last row may be
 * short). Left/right wrap within the row, up/down wrap within the column,
 * Tab ('next') walks all cells in order.
 */
export function gridStep(from: number, dir: GridDir, n: number): number {
  if (n <= 1)
    return 0
  if (dir === 'next')
    return (from + 1) % n
  const r = Math.floor(from / 3)
  const c = from % 3
  const rowLen = Math.min(3, n - r * 3)
  if (dir === 'left')
    return r * 3 + ((c + rowLen - 1) % rowLen)
  if (dir === 'right')
    return r * 3 + ((c + 1) % rowLen)
  const rows = Math.ceil((n - c) / 3)
  const nr = dir === 'up' ? (r + rows - 1) % rows : (r + 1) % rows
  return nr * 3 + c
}
