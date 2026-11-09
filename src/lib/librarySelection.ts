/** Modifier state of a thumbnail click, resolved by the drawer into a selection op. */
export interface PickMods {
  toggle: boolean
  range: boolean
}

/**
 * The library's batch selection: the picked ids in click order (the order
 * `assignMany` fills panes) and the anchor a shift-range starts from. A plain
 * click is not a selection at all; it clears the batch and assigns the one
 * photo, which the caller does.
 */
export interface LibrarySelection {
  ids: string[]
  anchor: string | null
}

export type LibrarySelectionEvent
  = | { type: 'pick', id: string, order: readonly string[], mods: PickMods }
    | { type: 'clear' }

export const EMPTY_LIBRARY_SELECTION: LibrarySelection = { ids: [], anchor: null }

function isBlank(state: LibrarySelection): boolean {
  return state.ids.length === 0 && state.anchor == null
}

/**
 * A range replaces the batch with the slice between the anchor and the clicked
 * photo. The anchor survives it, so the next shift-click measures from the
 * same place. An anchor the current library lost makes the range just the
 * clicked photo.
 */
function rangePick(state: LibrarySelection, at: number, order: readonly string[]): LibrarySelection {
  const anchorAt = state.anchor ? order.indexOf(state.anchor) : -1
  const from = Math.min(anchorAt === -1 ? at : anchorAt, at)
  const to = Math.max(anchorAt === -1 ? at : anchorAt, at)
  return { ids: order.slice(from, to + 1), anchor: state.anchor }
}

/** A toggle flips one id and moves the anchor to it. */
function togglePick(state: LibrarySelection, id: string): LibrarySelection {
  const picked = state.ids.includes(id)
  return {
    ids: picked ? state.ids.filter(x => x !== id) : [...state.ids, id],
    anchor: id,
  }
}

/**
 * The one pick rule. A range or toggle edits the batch; a plain click clears
 * it (assigning is the caller's separate act). An id the current library lost
 * is skipped rather than trusted, so a selection can never name a photo the
 * list no longer shows.
 */
export function librarySelectionTransition(state: LibrarySelection, event: LibrarySelectionEvent): LibrarySelection {
  if (event.type === 'clear')
    return isBlank(state) ? state : EMPTY_LIBRARY_SELECTION

  const at = event.order.indexOf(event.id)
  if (at === -1)
    return state
  if (event.mods.range)
    return rangePick(state, at, event.order)
  if (event.mods.toggle)
    return togglePick(state, event.id)
  return isBlank(state) ? state : EMPTY_LIBRARY_SELECTION
}

/** The ids still in the list, in pick order: what the drawer actually shows as selected. */
export function selectedInOrder(state: LibrarySelection, order: readonly string[]): string[] {
  return state.ids.filter(id => order.includes(id))
}
