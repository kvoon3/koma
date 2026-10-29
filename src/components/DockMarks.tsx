/* eslint-disable react-refresh/only-export-components -- the store and its two hooks are this module's API; the provider is only a thin wrapper. */
import type { PopoverPopupProps, PopoverRootChangeEventDetails } from '@base-ui/react/popover'
import type { CSSProperties, ReactNode, RefCallback, RefObject } from 'react'
import type { DockBox } from '../lib/dockHighlight'
import type { DockHop, DockMarkEvent, DockMarks, DockOpenSnapshot, DockPointerFacts } from '../lib/dockMark'
import { createContext, use, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { boxIn } from '../lib/dockBox'
import { DOCK_FLIP_S } from '../lib/dockFlip'
import { glideDelta, hopDelta, isStill, sameRowBand } from '../lib/dockHighlight'
import { EMPTY_MARKS, markOf, reduceDockMarks } from '../lib/dockMark'
import { EASE_OUT_CSS } from '../lib/motionTokens'

/**
 * The dock's shared tool-row state and its DOM drivers (see lib/dockMark for
 * the contract). One store holds the marked button and the one open panel; one
 * listener layer on the tool scroller feeds it; two surfaces consume it:
 *
 * - `useDockPopover` (a tool with a popover): a per-seat primitive snapshot, so
 *   a hand-over re-renders only the two popovers whose status changed. The
 *   trigger element is the seat's identity: a remount cannot match a stale
 *   claim, which is issue #76 made structural.
 * - `useDockHighlight` (the sheet): imperative by construction. A hover
 *   crossing is a pointer-rate event and must not re-render DockSheet.
 *
 * Listeners are native and live on the scroller, never React handlers on the
 * sheet: route tools portal into the sheet's DOM but not its fiber tree, so the
 * sheet's React pointer handlers never see a press that starts on a tool.
 */

/** The pitch a pointer-to-pointer glide covers. */
const GLIDE_S = 0.12

const NEUTRAL_FACTS: DockPointerFacts = { kind: 'plain', pointer: 'other', disabled: false, locked: false, aligned: true }

const isDisabled = (el: Element) => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true'

function rectOf(el: Element): DockBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function hopStyle(hop: DockHop): CSSProperties {
  return {
    '--dock-hop-x': `${hop.x}px`,
    '--dock-hop-y': `${hop.y}px`,
  } as CSSProperties
}

export interface DockMarkStore {
  getOpen: () => DockOpenSnapshot<HTMLElement>
  getMark: () => HTMLElement | null
  subscribeOpen: (fn: () => void) => () => void
  subscribeMark: (fn: (el: HTMLElement | null) => void) => () => void
  hover: (el: HTMLElement | null, facts: DockPointerFacts, hop: DockHop | null) => void
  leave: () => void
  press: (el: HTMLElement, disabled: boolean) => void
  release: () => void
  openFromTrigger: (el: HTMLElement) => void
  closeFromTrigger: (el: HTMLElement) => void
  stick: (el: HTMLElement) => void
  dismiss: () => void
  unmount: (el: HTMLElement) => void
  /** Drop every claim naming a node that is gone or renders nothing. */
  reconcile: () => void
  /** A reorder moved the tools under a still pointer: forget the mark. */
  dropMark: () => void
  /** The sheet was hidden or put away: close the portaled panel and hide the box. */
  suspend: () => void
  /** Native listeners on the tool scroller; returns the disconnect. */
  connect: (scroller: HTMLElement) => () => void
}

export function createDockMarkStore(): DockMarkStore {
  let state: DockMarks<HTMLElement> = EMPTY_MARKS
  let openSnapshot: DockOpenSnapshot<HTMLElement> = { open: null, exchange: null }
  let mark: HTMLElement | null = null
  const openListeners = new Set<() => void>()
  const markListeners = new Set<(el: HTMLElement | null) => void>()

  const dispatch = (event: DockMarkEvent<HTMLElement>) => {
    const prev = state
    const next = reduceDockMarks(prev, event)
    if (next === prev)
      return
    state = next
    // One channel per derived value: hover alone re-renders nobody.
    if (next.open !== prev.open) {
      const exchange = next.open?.source === 'hover' && prev.open != null && prev.open.el !== next.open.el
        ? { el: prev.open.el }
        : null
      openSnapshot = { open: next.open, exchange }
      for (const fn of openListeners) fn()
    }
    const nextMark = markOf(next)
    if (nextMark !== mark) {
      mark = nextMark
      for (const fn of markListeners) fn(nextMark)
    }
  }

  const hover = (el: HTMLElement | null, facts: DockPointerFacts, hop: DockHop | null) =>
    dispatch({ type: 'hover', el, facts, hop })

  const connect = (scroller: HTMLElement) => {
    const factsFor = (btn: HTMLElement): DockPointerFacts => {
      const openEl = state.open?.el ?? null
      return {
        kind: btn.closest('[data-dock-popover]') ? 'popover' : 'plain',
        pointer: 'mouse',
        disabled: isDisabled(btn),
        // The row is not a stable hover target mid-swipe or mid-band, and an
        // inert sheet is neither visible nor reachable.
        locked: !!scroller.closest('[inert], [data-dock-band], [data-swiping]'),
        aligned: openEl != null && openEl !== btn ? sameRowBand(rectOf(openEl), rectOf(btn)) : true,
      }
    }

    const onOver = (e: PointerEvent) => {
      // A touch fires a synthetic hover before its tap; handing over on it
      // would let the following click toggle the just-opened panel shut.
      if (e.pointerType !== 'mouse')
        return
      const btn = (e.target as Element | null)?.closest<HTMLElement>('button')
      if (!btn || !scroller.contains(btn)) {
        hover(null, NEUTRAL_FACTS, null)
        return
      }
      const openEl = state.open?.el ?? null
      const hop = openEl != null && openEl !== btn && btn.closest('[data-dock-popover]')
        ? hopDelta(rectOf(openEl), rectOf(btn))
        : null
      hover(btn, factsFor(btn), hop)
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0)
        return
      const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('button')
      if (!btn || !scroller.contains(btn))
        return
      dispatch({ type: 'press', el: btn, disabled: isDisabled(btn) })
    }

    const onLeave = () => dispatch({ type: 'leave' })
    // A release can land anywhere: the pointer may leave the row while down.
    const onUp = () => dispatch({ type: 'release' })

    scroller.addEventListener('pointerover', onOver, { passive: true })
    scroller.addEventListener('pointerdown', onDown, { passive: true })
    scroller.addEventListener('pointerleave', onLeave, { passive: true })
    window.addEventListener('pointerup', onUp, { capture: true, passive: true })
    window.addEventListener('pointercancel', onUp, { capture: true, passive: true })
    return () => {
      scroller.removeEventListener('pointerover', onOver)
      scroller.removeEventListener('pointerdown', onDown)
      scroller.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerup', onUp, { capture: true })
      window.removeEventListener('pointercancel', onUp, { capture: true })
    }
  }

  const reconcile = () => {
    const claims = [state.open?.el, state.hover, state.press]
    for (const el of claims) {
      if (el && (!el.isConnected || el.getClientRects().length === 0))
        dispatch({ type: 'unmount', el })
    }
  }

  return {
    getOpen: () => openSnapshot,
    getMark: () => mark,
    subscribeOpen: (fn) => {
      openListeners.add(fn)
      return () => openListeners.delete(fn)
    },
    subscribeMark: (fn) => {
      markListeners.add(fn)
      return () => markListeners.delete(fn)
    },
    hover,
    leave: () => dispatch({ type: 'leave' }),
    press: (el, disabled) => dispatch({ type: 'press', el, disabled }),
    release: () => dispatch({ type: 'release' }),
    openFromTrigger: el => dispatch({ type: 'open', el }),
    closeFromTrigger: el => dispatch({ type: 'close', el }),
    stick: el => dispatch({ type: 'stick', el }),
    dismiss: () => dispatch({ type: 'dismiss' }),
    unmount: el => dispatch({ type: 'unmount', el }),
    reconcile,
    dropMark: () => dispatch({ type: 'leave' }),
    suspend: () => {
      dispatch({ type: 'dismiss' })
      dispatch({ type: 'leave' })
    },
    connect,
  }
}

const DockMarkContext = createContext<DockMarkStore | null>(null)

/**
 * One store above both route children and the sheet. It must be the same
 * React tree: context flows through `createPortal`, while the sheet is a
 * sibling of the routes, not their ancestor.
 */
export function DockMarksProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createDockMarkStore)
  return <DockMarkContext value={store}>{children}</DockMarkContext>
}

export function useDockMarkStore(): DockMarkStore {
  const store = use(DockMarkContext)
  if (!store)
    throw new Error('DockMarks hooks must be used inside DockMarksProvider')
  return store
}

/** The popover hook's returned wiring; every field is identity-stable per seat. */
export interface DockPopoverWiring {
  readonly open: boolean
  readonly triggerRef: RefCallback<HTMLButtonElement>
  readonly rootProps: Readonly<{ triggerId: string }>
  readonly triggerProps: Readonly<{ 'id': string, 'data-dock-popover': string }>
  readonly popupProps: Readonly<DockPopupProps>
  onOpenChange: (open: boolean, details: PopoverRootChangeEventDetails) => void
  close: () => void
}

/** The Popup props the hook controls: the panel marker plus its motion policy. */
export interface DockPopupProps extends Omit<PopoverPopupProps, 'style'> {
  readonly 'style'?: CSSProperties
  readonly 'data-dock-popover-panel': string
  readonly 'data-dock-hop'?: string
  readonly 'data-dock-hop-out'?: string
}

/** The per-seat snapshot: only the two popovers a hand-over touches re-render. */
type DockSeatStatus = 'closed' | 'press' | 'hover' | 'leaving'

/**
 * `enabled` is required, not defaulted: it must be exactly the gate that can
 * unmount the trigger, so every call site states what could pull the popover's
 * own state out from under it (issue #76: a stage press can deselect the pane
 * mid-dispatch and no close event reaches the popover).
 */
export function useDockPopover(enabled: boolean, key?: string): DockPopoverWiring {
  const store = useDockMarkStore()
  const elRef = useRef<HTMLButtonElement | null>(null)
  const triggerId = useId()

  const subscribe = useCallback((onChange: () => void) => store.subscribeOpen(onChange), [store])
  const getStatus = useCallback((): DockSeatStatus => {
    const el = elRef.current
    if (!el)
      return 'closed'
    const snapshot = store.getOpen()
    if (snapshot.open?.el === el)
      return snapshot.open.source
    return snapshot.exchange?.el === el ? 'leaving' : 'closed'
  }, [store])
  const status = useSyncExternalStore(subscribe, getStatus, getStatus)

  const triggerRef = useCallback((el: HTMLButtonElement | null) => {
    if (el) {
      elRef.current = el
      return
    }
    const prev = elRef.current
    elRef.current = null
    // Issue #76, structural: the claim dies with its element, and a remounted
    // trigger creates a new element that no stale claim can name.
    if (prev)
      store.unmount(prev)
  }, [store])

  // A gate that shuts while the component stays mounted (Filter's early return
  // is a remount, but a conditional trigger could survive): release now.
  useLayoutEffect(() => {
    if (!enabled && elRef.current)
      store.closeFromTrigger(elRef.current)
  }, [enabled, store])

  const onOpenChange = useCallback((next: boolean, details: PopoverRootChangeEventDetails) => {
    const el = elRef.current
    if (!el)
      return
    if (next) {
      store.openFromTrigger(el)
      return
    }
    const current = store.getOpen().open
    // Base UI's `stickIfOpen` contract: a click on a hover-opened panel's own
    // trigger adopts the panel instead of toggling the hover open shut.
    if (details.reason === 'trigger-press' && current?.el === el && current.source === 'hover') {
      store.stick(el)
      return
    }
    store.closeFromTrigger(el)
  }, [store])

  const close = useCallback(() => {
    const el = elRef.current
    if (el)
      store.closeFromTrigger(el)
  }, [store])

  const open = enabled && (status === 'press' || status === 'hover')
  const popupProps: DockPopupProps = status === 'leaving'
    ? { 'data-dock-popover-panel': key ?? '', 'data-dock-hop-out': '', 'finalFocus': false }
    : status === 'hover'
      ? {
          'data-dock-popover-panel': key ?? '',
          'data-dock-hop': '',
          'initialFocus': false,
          'style': hopStyle(hopOf(store.getOpen(), elRef.current)),
        }
      : { 'data-dock-popover-panel': key ?? '' }

  return {
    open,
    triggerRef,
    rootProps: { triggerId },
    triggerProps: { 'id': triggerId, 'data-dock-popover': key ?? '' },
    popupProps,
    onOpenChange,
    close,
  }
}

/** The hop of a hover-open seat; zero when the snapshot is no longer that seat. */
function hopOf(snapshot: DockOpenSnapshot<HTMLElement>, el: HTMLElement | null): DockHop {
  if (snapshot.open?.source === 'hover' && snapshot.open.el === el)
    return snapshot.open.hop
  return { x: 0, y: 0 }
}

/** The sheet's imperative surface: every method is identity-stable. */
export interface DockHighlight {
  readonly boxRef: RefObject<HTMLDivElement | null>
  /** After a display commit: re-place under the buttons' committed layout. */
  afterCommit: (band: boolean) => void
  /** After measure / band exit / resize: re-place with no animation. */
  rebase: () => void
  /** After a tool-list mutation: drop dead references, re-place survivors. */
  reconcile: () => void
  /** A reorder moved the tools; the pointer is no longer on what it marked. */
  dropMark: () => void
  /** The sheet was hidden: hide the box and close the portalled panel. */
  suspend: () => void
  /** A band frame: copy the marked button's inline translate, no layout read. */
  frame: () => void
}

export function useDockHighlight({ containerRef, reduceRef }: {
  containerRef: RefObject<HTMLDivElement | null>
  reduceRef: RefObject<boolean | null>
}): DockHighlight {
  const store = useDockMarkStore()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const markRef = useRef<HTMLElement | null>(null)
  const shownRef = useRef(false)
  const animRef = useRef<Animation | null>(null)

  const hide = useCallback(() => {
    shownRef.current = false
    animRef.current?.cancel()
    animRef.current = null
    const box = boxRef.current
    if (!box)
      return
    box.style.transform = ''
    box.style.translate = ''
    box.style.opacity = '0'
  }, [])

  /**
   * The glide idiom `flipTool` uses: read the painted rect (a running
   * animation's transform is part of it), cancel, re-base, animate from the
   * fresh delta to zero with `fill: 'none'` so a cancel leaves no parked
   * transform. The destination is the button's layout box plus the container's
   * origin, never the button's own rect: mid-FLIP or mid-band that carries a
   * transform the layout does not have.
   */
  const place = useCallback((el: HTMLElement, mode: 'instant' | 'glide', duration = GLIDE_S) => {
    const box = boxRef.current
    const container = containerRef.current
    if (!box || !container)
      return
    if (!el.isConnected || el.getClientRects().length === 0 || isDisabled(el)) {
      hide()
      return
    }
    const { x, y } = boxIn(container, el)
    const width = el.offsetWidth
    const height = el.offsetHeight
    if (width < 1 || height < 1) {
      hide()
      return
    }
    const origin = container.getBoundingClientRect()
    const target: DockBox = { left: origin.left + x, top: origin.top + y, width, height }
    const painted = rectOf(box)
    const wasShown = shownRef.current
    animRef.current?.cancel()
    animRef.current = null
    box.style.left = `${x}px`
    box.style.top = `${y}px`
    box.style.width = `${width}px`
    box.style.height = `${height}px`
    box.style.opacity = '1'
    shownRef.current = true
    if (!wasShown || mode === 'instant' || reduceRef.current) {
      box.style.transform = ''
      box.style.translate = ''
      return
    }
    if (isStill(painted, target)) {
      box.style.transform = ''
      box.style.translate = ''
      return
    }
    const delta = glideDelta(painted, target)
    animRef.current = box.animate(
      [{ transform: `translate(${delta.x}px, ${delta.y}px)` }, { transform: 'translate(0px, 0px)' }],
      { duration: duration * 1000, easing: EASE_OUT_CSS, fill: 'none' },
    )
  }, [containerRef, hide, reduceRef])

  const frame = useCallback(() => {
    const box = boxRef.current
    const el = markRef.current
    if (box && el)
      box.style.translate = el.style.translate
  }, [])

  // The mark channel: one style batch per crossing, nothing else. A mark taken
  // mid-band follows the field through the button's own inline translate; one
  // taken mid-measure or mid-swipe is dropped, the row is not at rest.
  useEffect(() => {
    return store.subscribeMark((el) => {
      markRef.current = el
      if (!el) {
        hide()
        return
      }
      const scroller = containerRef.current?.parentElement
      if (scroller?.closest('[data-dock-measuring], [data-swiping]')) {
        hide()
        return
      }
      // Mid-band the buttons carry their displacement in `translate`: re-base
      // instantly and copy the marked button's string, no glide to compose.
      const banded = !!scroller?.closest('[data-dock-band]')
      place(el, banded ? 'instant' : 'glide')
      if (banded)
        frame()
    })
  }, [containerRef, frame, hide, place, store])

  useEffect(() => {
    const scroller = containerRef.current?.parentElement
    if (!scroller)
      return
    return store.connect(scroller)
  }, [containerRef, store])

  useEffect(() => () => animRef.current?.cancel(), [])

  const afterCommit = useCallback((band: boolean) => {
    const el = markRef.current
    if (!el)
      return
    // A band commit re-bases against the swapped layout and then mirrors the
    // field's projection; everything else glides from the box's own painted
    // rect at the button FLIP's duration.
    place(el, band ? 'instant' : 'glide', DOCK_FLIP_S)
    if (band)
      frame()
  }, [frame, place])

  const rebase = useCallback(() => {
    if (markRef.current)
      place(markRef.current, 'instant')
  }, [place])

  const reconcile = useCallback(() => {
    store.reconcile()
    if (markRef.current)
      place(markRef.current, 'instant')
    else
      hide()
  }, [hide, place, store])

  const dropMark = useCallback(() => {
    store.dropMark()
    hide()
  }, [hide, store])

  const suspend = useCallback(() => {
    store.suspend()
    hide()
  }, [hide, store])

  return useMemo(
    () => ({ boxRef, afterCommit, rebase, reconcile, dropMark, suspend, frame }),
    [afterCommit, frame, rebase, reconcile, dropMark, suspend],
  )
}
