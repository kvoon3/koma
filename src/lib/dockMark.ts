/**
 * The dock's two shared tool-row states, as pure data: which button the pointer
 * marks (the gliding background box) and which trigger owns the single open
 * popover. `components/DockMarks` owns the DOM side; this module owns only the
 * retention and hand-over contract, so the rules are testable without a DOM.
 *
 * The contract, in one line: hover alone opens nothing, a mouse on another
 * popover trigger in the same row hands the panel over, the pointer leaving the
 * row clears the mark but never the panel, and a removed trigger takes its
 * claims with it (issue #76).
 */

/** A panel's travel from the trigger it left, px, in viewport space. */
export interface DockHop {
  readonly x: number
  readonly y: number
}

/**
 * The two ways a panel can open. A handed-over panel carries the trigger it
 * left and the distance the panel travels; a pressed one carries neither.
 */
export type DockOpen<E>
  = | { readonly source: 'press', readonly el: E, readonly fromEl: null, readonly hop: null }
    | { readonly source: 'hover', readonly el: E, readonly fromEl: E, readonly hop: DockHop }

export interface DockMarks<E> {
  readonly open: DockOpen<E> | null
  /** The button under the pointer. */
  readonly hover: E | null
  /** The button the pointer went down on (touch's only mark). */
  readonly press: E | null
}

/** The open channel's snapshot: what is open, and whose panel just ended. */
export interface DockOpenSnapshot<E> {
  readonly open: DockOpen<E> | null
  /** The trigger a hand-over just closed; that panel ends instantly. */
  readonly exchange: { readonly el: E } | null
}

/** What the pointer layer knows and the reducer must not re-derive. */
export interface DockPointerFacts {
  /** A trigger that called `useDockPopover` (it carries `data-dock-popover`). */
  readonly kind: 'popover' | 'plain'
  /** Hand-over is a mouse gesture: touch fires a synthetic hover before its tap. */
  readonly pointer: 'mouse' | 'other'
  readonly disabled: boolean
  /** Mid-swiping, mid-band, or inert: the row is not a stable target. */
  readonly locked: boolean
  /** The candidate shares a row band with the open trigger. */
  readonly aligned: boolean
}

export type DockMarkEvent<E>
  = | { readonly type: 'hover', readonly el: E | null, readonly facts: DockPointerFacts, readonly hop: DockHop | null }
    | { readonly type: 'leave' }
    | { readonly type: 'press', readonly el: E, readonly disabled: boolean }
    | { readonly type: 'release' }
    | { readonly type: 'open', readonly el: E }
    | { readonly type: 'close', readonly el: E }
    | { readonly type: 'stick', readonly el: E }
    | { readonly type: 'dismiss' }
    | { readonly type: 'unmount', readonly el: E }

export const EMPTY_MARKS: DockMarks<never> = { open: null, hover: null, press: null }

/** The button the box is drawn under: a press wins over a hover. */
export function markOf<E>(state: DockMarks<E>): E | null {
  return state.press ?? state.hover
}

/**
 * A hand-over is a mouse on a popover trigger in the open trigger's row band,
 * while something is already open. Hover with nothing open opens nothing
 * (retention), and a plain action never opens anything.
 */
function handsOver<E>(state: DockMarks<E>, event: Extract<DockMarkEvent<E>, { type: 'hover' }>): boolean {
  return event.el != null
    && event.facts.kind === 'popover'
    && event.facts.pointer === 'mouse'
    && !event.facts.disabled
    && !event.facts.locked
    && event.facts.aligned
    && state.open != null
}

function sameHover<E>(state: DockMarks<E>, hover: E | null): DockMarks<E> {
  return state.hover === hover ? state : { ...state, hover }
}

/** Drop every claim naming the removed element (issue #76, lane swaps). */
function dropEl<E>(state: DockMarks<E>, el: E): DockMarks<E> {
  const open = state.open?.el === el ? null : state.open
  const hover = state.hover === el ? null : state.hover
  const press = state.press === el ? null : state.press
  if (open === state.open && hover === state.hover && press === state.press)
    return state
  return { open, hover, press }
}

export function reduceDockMarks<E>(state: DockMarks<E>, event: DockMarkEvent<E>): DockMarks<E> {
  switch (event.type) {
    case 'hover':
      return reduceHover(state, event)
    case 'leave':
      // The pointer left the row: the box hides, the panel is retained.
      return state.hover == null && state.press == null ? state : { ...state, hover: null, press: null }
    case 'press':
      return event.disabled || state.press === event.el ? state : { ...state, press: event.el }
    case 'release':
      return state.press == null ? state : { ...state, press: null }
    case 'open':
      return openDock(state, event.el)
    case 'close':
      // Identity guard: a sibling's stale close must not clear the panel that
      // just took over from it (TopBar's `onOpenChange` guard, generalised).
      return state.open?.el === event.el ? { ...state, open: null } : state
    case 'stick':
      return stickDock(state, event.el)
    case 'dismiss':
      return state.open == null ? state : { ...state, open: null }
    case 'unmount':
      return dropEl(state, event.el)
  }
}

function reduceHover<E>(state: DockMarks<E>, event: Extract<DockMarkEvent<E>, { type: 'hover' }>): DockMarks<E> {
  if (event.el == null || !handsOver(state, event))
    return sameHover(state, event.el)
  const current = state.open
  if (current == null || current.el === event.el)
    return sameHover(state, event.el)
  return {
    ...state,
    hover: event.el,
    open: { source: 'hover', el: event.el, fromEl: current.el, hop: event.hop ?? { x: 0, y: 0 } },
  }
}

function openDock<E>(state: DockMarks<E>, el: E): DockMarks<E> {
  if (state.open?.source === 'press' && state.open.el === el)
    return state
  return { ...state, open: { source: 'press', el, fromEl: null, hop: null } }
}

/** A click on a hover-opened panel's trigger adopts the open as a press. */
function stickDock<E>(state: DockMarks<E>, el: E): DockMarks<E> {
  if (state.open?.source !== 'hover' || state.open.el !== el)
    return state
  return { ...state, open: { source: 'press', el, fromEl: null, hop: null } }
}
