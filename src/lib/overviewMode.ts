/**
 * The overview's three modes and the one table that decides what each may do.
 * Pure: every transition is a row here, and no surface can invent one.
 *
 * `manage` is a sibling of `jiggle`, not a layer on it: the manager is a modal
 * dialog and the stage behind it is tried by nothing. Opening the manager from
 * jiggle ends jiggle first, and closing returns to browse.
 */

export type OverviewMode = 'browse' | 'jiggle' | 'manage'
export type OverviewEvent = 'hold-air' | 'open-manager' | 'close-manager' | 'done'

export interface OverviewPolicy {
  /** A horizontal swipe changes the board. */
  readonly pages: boolean
  /** A cell tap (or Enter) opens the editor. */
  readonly entersCell: boolean
  /** The X badges are mounted and live. */
  readonly deletesCells: boolean
  /** A 500ms hold on air enters jiggle. */
  readonly airHoldEntersJiggle: boolean
  /** A tap on air leaves jiggle. */
  readonly airTapExits: boolean
  /** The caption row shows Done instead of the snapshot chip. */
  readonly showsDone: boolean
}

/** What each mode allows. The UI reads only this table. */
export const OVERVIEW_POLICY: Record<OverviewMode, OverviewPolicy> = {
  browse: {
    pages: true,
    entersCell: true,
    deletesCells: false,
    airHoldEntersJiggle: true,
    airTapExits: false,
    showsDone: false,
  },
  jiggle: {
    pages: true,
    entersCell: false,
    deletesCells: true,
    airHoldEntersJiggle: false,
    airTapExits: true,
    showsDone: true,
  },
  manage: {
    pages: false,
    entersCell: false,
    deletesCells: false,
    airHoldEntersJiggle: false,
    airTapExits: false,
    showsDone: false,
  },
}

/**
 * The mode after an event. Total: an event that does not apply comes back as
 * the same mode, so every caller can dispatch without guarding.
 */
export function nextOverviewMode(mode: OverviewMode, event: OverviewEvent): OverviewMode {
  if (event === 'hold-air')
    return mode === 'browse' ? 'jiggle' : mode
  if (event === 'open-manager')
    return mode === 'manage' ? mode : 'manage'
  if (event === 'close-manager')
    return mode === 'manage' ? 'browse' : mode
  // done: Done, Esc or an air tap, and only jiggle has anything to end.
  return mode === 'jiggle' ? 'browse' : mode
}
