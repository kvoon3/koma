/**
 * Pure rules for the workspace grid (the overview): how many cells the
 * board holds and how adding, removing and restoring them behave. Generic
 * over the workspace shape so they test without the store.
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
