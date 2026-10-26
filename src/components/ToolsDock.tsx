import type { MotionValue } from 'motion/react'
import type { CSSProperties, Dispatch, ReactNode, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import type { BandSlot, DockToolBoxes } from '../lib/dockBand'
import type { FlipBox } from '../lib/dockFlip'
import type { DockSwapPlan } from '../lib/dockSwap'
import type { TKey } from '../lib/locales/zh-Hans'
import type { DockCapacity } from '../lib/toolsDockMode'
import type { ToolsDockMode } from '../store'
import { Popover } from '@base-ui/react/popover'
import { ChevronDown, ChevronUp, Ratio, RotateCw, Square } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { animate, useMotionValue, useReducedMotion } from 'motion/react'
import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { flipCanvasRatio, matchCanvasToFirstPhoto, setCanvasRatio, SQUARE_RATIO } from '../lib/canvasCommands'
import { dockDragFade, dockSurface } from '../lib/dockBackground'
import { bandProgress, bandPush, bandSchedule } from '../lib/dockBand'
import { DOCK_FLIP_EASE_CSS, DOCK_FLIP_S, isBoxVisible, parseTranslate, planFlipItem, shiftFlipBox } from '../lib/dockFlip'
import { dampOffset, dragOwner, nearestSnapIndex, pickSnap } from '../lib/dockPhysics'
import { DOCK_SWAP_EASE, DOCK_SWAP_PAIR_MS, DOCK_SWAP_PX, DOCK_SWAP_S, planDockSwap } from '../lib/dockSwap'
import { useT } from '../lib/i18n'
import { liquidGlassRef } from '../lib/liquidGlass'
import { EASE_OUT } from '../lib/motionTokens'
import { paneAssetsOf } from '../lib/stickerLibrary'
import { clampDockMode, dockDisplayAt, dockHandleIntent, dockModeAtHeight, dockModes, dockTransition, isBandTransition } from '../lib/toolsDockMode'
import { scrollFadeStyle, scrollFadeStyleX, useScrollFade } from '../lib/useScrollFade'
import { activeWs, useStore } from '../store'
import { Footer } from './Footer'
import { dockBtnStateCls, dockBtnSurfaceCls, dockPopupMotionCls, menuItemCls, menuSurfaceCls } from './ui/menu'

/**
 * The dock's tool button and its caption. Both follow the sheet's display mode
 * (`data-dock-mode` on the sheet, `group/dock`): in the icon-only row the
 * caption folds away and the button narrows to its icon, so the tools hold one
 * row. The caption fades and collapses over --dur-fast rather than dropping, so
 * a display flip during a drag (DockSheet switches live, see
 * lib/toolsDockMode) reads as a morph; reduced motion swaps it in one frame.
 */
export const toolsBtnCls = `${dockBtnSurfaceCls} disabled:order-1 data-disabled:order-1 flex w-[80px] shrink-0 flex-col items-center justify-center gap-1.5 whitespace-nowrap px-2 py-3 group-data-[dock-mode=icons]/dock:w-[54px] group-data-[dock-mode=icons]/dock:gap-0 group-data-[dock-mode=icons]/dock:py-2.5`
export const toolsLabelCls = 'max-h-[2em] overflow-hidden text-[11.5px] font-semibold text-txt transition-[opacity,max-height] duration-(--dur-fast) ease-(--ease-out) group-data-[dock-mode=icons]/dock:max-h-0 group-data-[dock-mode=icons]/dock:opacity-0 motion-reduce:duration-0'

/** Handle chrome height. Keep in sync with `handleCls` h-[]. */
const HANDLE_H = 28
/**
 * The expanded list's vertical scrollbar gutter, px: `scrollExpCls` asks for
 * `overflow-y: scroll`, so the wrap leg must reserve the gutter it takes. 9 is
 * the width that class styles its thumb to; overlay scrollbars take none, and
 * `clientWidth` reports the difference, so both kinds of system agree.
 */
const EXP_GUTTER = 9
const MAX_EXP_VH = 0.4
const FALLBACK_ROW = 72
const FALLBACK_ICON_ROW = 48

const handleCls = 'relative z-1 flex h-[28px] w-full shrink-0 cursor-grab touch-none select-none items-center justify-center border-0 bg-transparent p-0 text-float-icon transition-[color,scale] duration-(--dur-surface) active:cursor-grabbing active:scale-[0.97] hover:text-txt'
const scrollRowCls = 'overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
/**
 * The expanded list scrolls with `overflow-y: scroll`, never `auto`: the wrap
 * only depends on the list's width, and a classic scrollbar (Windows, macOS
 * with always-show) takes 9px of that width. With `auto` the gutter appears
 * and disappears with the overflow, so the width, the wrap and the overflow
 * feed each other: the wrapped rows flip between 2 and 3, the sheet's snap
 * height with them, and the items jitter at frame rate. Always reserving the
 * gutter makes the width independent of the overflow. Overlay scrollbars
 * reserve nothing, so those environments are unchanged (measured).
 */
const scrollExpCls = 'overflow-x-hidden overflow-y-scroll overscroll-contain [&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
/**
 * While the drawer itself is being dragged, or a display band is in flight,
 * its lists hold still (`data-swiping`, `data-dock-band` on the sheet). The
 * band case keeps the list's own overflow: `overflow: hidden` would drop the
 * wrapped list's classic-scrollbar gutter and re-wrap the very layout the
 * field's transforms are projected against. `touch-action: none` is what
 * actually stops the native pan, and a frozen press never reaches the list
 * anyway (lib/dockPhysics).
 */
const scrollLockCls = 'group-data-swiping/dock:overflow-hidden group-data-swiping/dock:touch-none group-data-dock-band/dock:touch-none'
const rowCls = 'flex w-max items-stretch'
const wrapCls = 'flex w-full flex-wrap items-stretch justify-center'

// @x18n-keys
const INTENT_LABEL = { expand: 'Expand tools', collapse: 'Collapse tools' } as const satisfies Record<'expand' | 'collapse', TKey>
const INTENT_ICON = { expand: ChevronUp, collapse: ChevronDown } as const

/** Settle spring (Vaul-like feel: quick, barely any overshoot). */
const SPRING = { type: 'spring', stiffness: 420, damping: 42, mass: 1 } as const
/** px before a press becomes a drag (taps stay clicks). */
const DRAG_SLOP = 6
/**
 * Seconds a handle tap takes to walk the display band. A release keeps the
 * spring (the flick's own velocity is the pace), but a tap has no finger to set
 * one, and the settle spring crosses the band in a couple of frames at peak
 * velocity, too fast for the per-tool stagger to read as a cascade.
 */
const DOCK_BAND_TAP_S = 0.42

const ratioPopupCls = `${menuSurfaceCls} ${dockPopupMotionCls} min-w-[190px]`
const ratioItemCls = `${menuItemCls} disabled:cursor-default disabled:opacity-35`

/** A ratio is square when it sits within a hair of 1 (float drift from a flip). */
const isSquare = (ratio: number | null) => ratio != null && Math.abs(ratio - SQUARE_RATIO) < 0.005

/** A tool's on-screen box before a display flip (see `captureFlipFrom`). */
interface FlipFrom {
  box: FlipBox
  /** The in-flight FLIP translate the box already carries. */
  translate: { x: number, y: number }
  visible: boolean
}

/** What an interrupted FLIP was showing when the flip committed (see `detachFlip`). */
interface FlipDetach {
  translate: { x: number, y: number }
  opacity: number
}

const flipBox = (r: DOMRect): FlipBox => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })

/**
 * Drop every in-flight flip (interrupt, reduced motion, unmount). Both halves
 * are raw WAAPI with `fill: 'none'`, so a cancel reverts the tool to its CSS
 * without touching the DOM's inline style.
 */
function stopFlips(anims: Map<HTMLElement, FlipAnims>) {
  for (const a of anims.values()) {
    a.move?.cancel()
    a.fade?.cancel()
  }
  anims.clear()
}

/** A tool's in-flight flip: the glide and the fade. */
interface FlipAnims {
  move: Animation | null
  fade: Animation | null
}

/**
 * One tool across a flip: glide it from the box it was showing to its new one,
 * and fade it up when the flip uncovered it (or interrupted a fade already in
 * flight). `seen` is what the tool showed at the commit; `base` is its resting
 * opacity: the disabled tools sit below 1, and the fade has to land there.
 *
 * Both halves are raw WAAPI (`fill: 'none'`), not Motion's `animate` like the
 * reorder flip below. Flips interrupt each other mid-glide, and Motion keeps a
 * per-element set of motion values whose async keyframe resolution can commit a
 * stale transform between the cancel and the next start (a tool left parked off
 * its box). A plain animation has no such state: cancel reverts to the CSS,
 * and with no fill no inline style is left to out-rank the disabled opacity
 * (Motion writes its final value inline, an inline `opacity: 1` would).
 */
function flipTool(h: HTMLElement, input: {
  from: FlipFrom
  seen: FlipDetach | undefined
  to: FlipBox
  view: FlipBox
  base: number
}): FlipAnims | null {
  const { from, seen, to, view, base } = input
  // The last painted box: the captured one plus however far a flip that was
  // still running when this commit landed has travelled since the capture.
  const start = shiftFlipBox(
    from.box,
    (seen?.translate.x ?? 0) - from.translate.x,
    (seen?.translate.y ?? 0) - from.translate.y,
  )
  const plan = planFlipItem({ from: start, to, view })
  const moving = plan.x !== 0 || plan.y !== 0
  // A fade still running when the commit landed resumes from where it is; a
  // fresh uncover starts at 0, so the tool is never one frame at full strength.
  const current = seen?.opacity ?? base
  const midFade = current < base - 0.001
  const fade = plan.visible && (plan.enter || midFade)
  if (!moving && !fade)
    return null
  const timing = { duration: DOCK_FLIP_S * 1000, easing: DOCK_FLIP_EASE_CSS, fill: 'none' } as const
  return {
    move: moving
      ? h.animate([{ transform: `translate(${plan.x}px, ${plan.y}px)` }, { transform: 'translate(0px, 0px)' }], timing)
      : null,
    fade: fade
      ? h.animate([{ opacity: String(plan.enter && !midFade ? 0 : current) }, { opacity: String(base) }], timing)
      : null,
  }
}

interface DockSlot { hidden: boolean, contextKey: string }
interface DockCtx {
  target: HTMLDivElement | null
  setSlot: Dispatch<SetStateAction<DockSlot | null>>
}
const ToolsDockContext = createContext<DockCtx | null>(null)

/**
 * Route-level dock content. Portals `children` into the single persistent
 * dock owned by `ToolsDockHost`, so switching routes (grid ⇄ stage) swaps
 * content without remounting the Drawer (a remount replays the enter
 * animation and re-seeds snap points from fallback heights → jitter).
 *
 * The canvas ratio tool rides along here rather than in a route's tool list:
 * it is a property of the sheet, and it is offered whenever the route reports
 * the canvas context (stage with no pane to act on) and nothing is focused.
 */
export function ToolsDock({ hidden, contextKey, children }: {
  hidden: boolean
  contextKey: string
  children: ReactNode
}) {
  const ctx = use(ToolsDockContext)
  const setSlot = ctx?.setSlot
  const noPaneFocus = useStore(s => !activeWs(s).focusId)
  useLayoutEffect(() => {
    setSlot?.({ hidden, contextKey })
  }, [setSlot, hidden, contextKey])
  useLayoutEffect(() => () => setSlot?.(null), [setSlot])
  if (!ctx?.target)
    return null
  const ratio = contextKey === 'canvas' && noPaneFocus
  return createPortal(
    <>
      {children}
      {ratio ? <CanvasRatioDockTool /> : null}
    </>,
    ctx.target,
  )
}

/**
 * The canvas ratio as a dock tool (see `ToolsDock`): the rows are the
 * workspace menu's ratio group, so both surfaces run the same commands
 * (lib/canvasCommands) and neither re-derives them. Every one of them goes
 * through `setCanvasSize`, which already commits the undo step.
 */
function CanvasRatioDockTool() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ratio = useStore(s => activeWs(s).canvasRatio)
  const hasPhoto = useStore(s => paneAssetsOf(s.photos).some(p => p.trueW > 0 && p.trueH > 0))

  const options = [
    { key: 'square', icon: Square, label: t('Square (1:1)'), disabled: isSquare(ratio), run: () => setCanvasRatio(SQUARE_RATIO) },
    { key: 'match', icon: Ratio, label: t('Match the canvas to the first photo'), disabled: !hasPhoto, run: () => matchCanvasToFirstPhoto() },
    { key: 'flip', icon: RotateCw, label: t('Flip canvas orientation'), disabled: ratio == null, run: () => flipCanvasRatio() },
  ]

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`${toolsBtnCls} ${dockBtnStateCls}`}
        title={t('Canvas ratio')}
        aria-label={t('Canvas ratio')}
        data-dock-tool={t('Canvas ratio')}
        data-dock-ratio=""
      >
        <MorphIcon icon={Ratio} size={22} strokeWidth={1.5} />
        <span className={toolsLabelCls}>{t('Ratio')}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={6} collisionPadding={6} className="z-[260] select-none outline-0">
          <Popover.Popup className={ratioPopupCls}>
            {options.map(o => (
              <button
                key={o.key}
                type="button"
                className={ratioItemCls}
                disabled={o.disabled}
                onClick={() => {
                  o.run()
                  setOpen(false)
                }}
              >
                <MorphIcon icon={o.icon} size={15} strokeWidth={1.75} />
                {o.label}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * Full-width Base UI Drawer tools sheet, mounted once in the root layout:
 * handle + tools snap above an always-on Footer strip. Every display holds
 * tools (icon-only row / labelled row / wrapped multi-row, expanded only when
 * the tools do not fit one row), so the sheet is never put away. The handle
 * icon morphs up (next tap opens more) → down (next tap drops the labels).
 */
export function ToolsDockHost({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [slot, setSlot] = useState<DockSlot | null>(null)
  const ctx = useMemo(() => ({ target, setSlot }), [target])
  return (
    <ToolsDockContext value={ctx}>
      {children}
      <DockSheet hidden={slot == null || slot.hidden} contextKey={slot?.contextKey ?? ''} innerRef={setTarget} />
    </ToolsDockContext>
  )
}

/** The drag gesture's live state while a pointer is down on the sheet. */
interface DockDrag {
  id: number
  x: number
  y: number
  start: number
  active: boolean
  /** The press landed in the horizontally scrolled tools row. */
  horizontal: boolean
  /** The press landed in the expanded list, with that list's scroll state at the press. */
  list: { scrollTop: number, clientHeight: number, scrollHeight: number } | null
  /**
   * The snap the gesture started on (`pickSnap`'s `from`). Required, not
   * optional, once the display latches at the band edges: mid-band the display
   * on screen is the lower one, so the release's own display would make a
   * downward flick from high in the band jump two snaps instead of one.
   */
  startIdx: number
}

/** The geometry the transform and the drag math are written against. */
interface DockGeometry {
  toolsMaxH: number
  rowH: number
  order: readonly ToolsDockMode[]
  heights: number[]
  offsets: number[]
  offset: number
}

/** Every tool's box in both endpoint layouts, keyed by its button (see lib/dockBand). */
type DockEndpoints = ReadonlyMap<HTMLElement, DockToolBoxes>

/**
 * A child's layout box relative to its container, px. `offsetLeft/Top` are
 * relative to the nearest positioned ancestor rather than to the parent node,
 * and the tools container is deliberately unpositioned, so its own offsets are
 * what makes a child's box container-relative. `offsetParent` is checked
 * rather than assumed: a container that gains `position` must not silently
 * shift every endpoint.
 */
function boxIn(container: HTMLElement, child: HTMLElement): { x: number, y: number } {
  if (child.offsetParent === container)
    return { x: child.offsetLeft, y: child.offsetTop }
  return { x: child.offsetLeft - container.offsetLeft, y: child.offsetTop - container.offsetTop }
}

/** Every direct child's box in whatever layout the container holds right now. */
function captureChildBoxes(container: HTMLElement): Map<HTMLElement, { x: number, y: number }> {
  const boxes = new Map<HTMLElement, { x: number, y: number }>()
  for (const child of container.children)
    boxes.set(child as HTMLElement, boxIn(container, child as HTMLElement))
  return boxes
}

/**
 * The width the expanded display wraps at: the scroller's client width with
 * its vertical scrollbar gutter taken off. The element's classes belong to
 * whichever display is on screen, so the gutter is emulated here by putting
 * `overflow-y: scroll` on the scroller and reading the width back. Overlay
 * scrollbars (macOS default) lose nothing; a classic one loses `EXP_GUTTER`.
 */
function expandedWrapWidth(scroller: HTMLElement | null, panelW: number): number {
  if (!scroller)
    return panelW
  const before = scroller.clientWidth
  scroller.style.overflowY = 'scroll'
  scroller.style.overflowX = 'hidden'
  const classic = scroller.clientWidth < before
  const width = before - (classic ? EXP_GUTTER : 0)
  return width >= 1 ? width : panelW
}

/**
 * Measure what the dock needs to snap and to decide its display: the icon-row,
 * labelled-row and wrapped heights, whether every tool fits one row, and each
 * tool's box in the row and wrapped layouts (the displacement field's
 * endpoints, lib/dockBand). `measure` restyles the content synchronously to
 * read each layout, so a drag or a running band defers it to the release
 * instead of fighting the live transform.
 */
function useDockMeasure({
  innerRef,
  contextKey,
  storedMode,
  modeRef,
  fitsOneRow,
  setFitsOneRow,
  captureFlipFrom,
  bandActiveRef,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>
  contextKey: string
  storedMode: ToolsDockMode
  modeRef: React.RefObject<ToolsDockMode>
  fitsOneRow: boolean
  setFitsOneRow: (fits: boolean) => void
  captureFlipFrom: () => void
  /** The display band owns the list: its restyle pass would tear the field apart. */
  bandActiveRef: React.RefObject<boolean>
}) {
  const [rowH, setRowH] = useState(FALLBACK_ROW)
  const [iconH, setIconH] = useState(FALLBACK_ICON_ROW)
  const [expH, setExpH] = useState(FALLBACK_ROW)
  /** A drag owns the sheet: no restyle pass may run under it (see `measure`). */
  const draggingRef = useRef(false)
  /** A `measure()` skipped mid-drag, re-run when the drag settles. */
  const measureDirtyRef = useRef(false)
  /** Every tool's row and wrapped boxes, captured by the last completed pass. */
  const endpointsRef = useRef<DockEndpoints>(new Map())
  /** The committed capacity and stored display, read by `measure`'s cap-flip guess. */
  const fitsRef = useRef(fitsOneRow)
  const storedModeRef = useRef(storedMode)
  useLayoutEffect(() => {
    fitsRef.current = fitsOneRow
    storedModeRef.current = storedMode
  })

  const measure = useCallback(() => {
    const el = innerRef.current
    if (!el)
      return
    // The pass below restyles the content (forced display modes, full width)
    // under the live transform, so a drag defers it to the release. The band
    // inherits that guard for the same reason: its transforms are written
    // against boxes this pass would move.
    if (draggingRef.current || bandActiveRef.current) {
      measureDirtyRef.current = true
      return
    }
    const maxExp = Math.round(window.innerHeight * MAX_EXP_VH)
    // The temporary restyle below (full width + wrap) shrinks the row's content
    // to the viewport, and the browser then clamps the row's native scrollLeft
    // to 0. Remember it so the position survives every measure (a popover
    // opening adds nodes, which re-runs this).
    const scroller = el.parentElement
    const scrollLeft = scroller?.scrollLeft ?? 0
    // The expanded list scrolls vertically and suffers the same clamp when the
    // measured wrap changes the list's height (a short screen, e.g. 390×500).
    const scrollTop = scroller?.scrollTop ?? 0
    // What the row looks like is the sheet's display mode (the icon-only row
    // drops the captions in CSS), so the two row heights are measured with the
    // mode forced: a hidden, synchronous pass, nothing paints in between.
    const sheet = el.closest<HTMLElement>('[data-dock-mode]')
    const prevMode = sheet?.getAttribute('data-dock-mode')
    // The forced passes must read final sizes: a caption still fading (or about
    // to) would report a transitioned height as the mode's height. Transitions
    // off for the synchronous pass, restored with the styles below; nothing
    // paints in between.
    sheet?.setAttribute('data-dock-measuring', '')
    const prevWrap = el.style.flexWrap
    const prevW = el.style.width
    const prevMax = el.style.maxWidth
    const prevVis = el.style.visibility
    const prevJustify = el.style.justifyContent
    const prevOverflowX = scroller?.style.overflowX ?? ''
    const prevOverflowY = scroller?.style.overflowY ?? ''
    // Full sheet width, not the popup's (it shrinks to the handle when the
    // tools row fits).
    const panelW = el.closest<HTMLElement>('.tools-dock')?.clientWidth || window.innerWidth
    sheet?.setAttribute('data-dock-mode', 'row')
    el.style.visibility = 'hidden'
    el.style.flexWrap = 'nowrap'
    el.style.width = 'max-content'
    el.style.maxWidth = 'none'
    // The row leg is left-aligned: `rowCls` states no justify-content, and the
    // element may still carry `wrapCls`' centre from the live display. Each
    // leg states its own value so the measured boxes are that layout's.
    el.style.justifyContent = 'flex-start'
    const box = el.getBoundingClientRect()
    const row = Math.ceil(box.height) || FALLBACK_ROW
    const rowW = Math.ceil(box.width)
    const rowBoxes = captureChildBoxes(el)
    // The wrapped leg wraps at the expanded list's content width, not the
    // panel's (see `expandedWrapWidth`), and centres its rows the way
    // `wrapCls` does. A position field is wrong by half that difference at the
    // ends, so the leg has to say which layout it is.
    const wrapW = expandedWrapWidth(scroller, panelW)
    el.style.flexWrap = 'wrap'
    el.style.width = '100%'
    el.style.maxWidth = `${wrapW}px`
    el.style.justifyContent = 'center'
    const exp = Math.min(Math.ceil(el.scrollHeight) || row, maxExp)
    const wrapBoxes = captureChildBoxes(el)
    let iconRow = FALLBACK_ICON_ROW
    if (sheet) {
      sheet.setAttribute('data-dock-mode', 'icons')
      el.style.flexWrap = 'nowrap'
      el.style.width = 'max-content'
      el.style.maxWidth = 'none'
      el.style.justifyContent = 'flex-start'
      iconRow = Math.ceil(el.getBoundingClientRect().height) || FALLBACK_ICON_ROW
      sheet.setAttribute('data-dock-mode', prevMode ?? 'row')
    }
    el.style.flexWrap = prevWrap
    el.style.width = prevW
    el.style.maxWidth = prevMax
    el.style.visibility = prevVis
    el.style.justifyContent = prevJustify
    if (scroller) {
      scroller.style.overflowX = prevOverflowX
      scroller.style.overflowY = prevOverflowY
    }
    // Commit the restored display while transitions are still off: the icons
    // pass forces the caption to max-height 0, and restoring it alone would
    // animate the caption back, so every pass started a fade whose mid-fade
    // height flipped the list's overflow and re-triggered the pass.
    void el.offsetHeight
    sheet?.removeAttribute('data-dock-measuring')
    // Styles are back and nothing has painted since the clamp: put the row
    // where the user left it, so tapping a tool does not scroll the row (and
    // its popover's anchor) away.
    if (scroller && scroller.scrollLeft !== scrollLeft)
      scroller.scrollLeft = scrollLeft
    if (scroller && scroller.scrollTop !== scrollTop)
      scroller.scrollTop = scrollTop
    // Both legs ran over the same children in one synchronous pass, so a child
    // with a row box has a wrapped one; the lookup guards a mismatch anyway.
    const endpoints = new Map<HTMLElement, DockToolBoxes>()
    for (const [child, rowBox] of rowBoxes) {
      const wrapBox = wrapBoxes.get(child)
      if (wrapBox)
        endpoints.set(child, { row: rowBox, wrap: wrapBox })
    }
    endpointsRef.current = endpoints
    setRowH(row)
    setIconH(iconRow)
    setExpH(Math.max(row, exp))
    // Empty slot (between routes) keeps the last capacity: no snap churn. The
    // ratio tool is not route content, so it does not count as content.
    if (el.querySelector(':scope > :not([data-dock-ratio])')) {
      const nextFits = rowW <= panelW
      // A capacity change can clamp the display (expanded → row once the tools
      // fit one row). That is not a gesture, so the boxes are captured here,
      // before the state lands, and the commit gets the same FLIP a flip does.
      if (nextFits !== fitsRef.current && clampDockMode(storedModeRef.current, { fitsOneRow: nextFits }) !== modeRef.current)
        captureFlipFrom()
      setFitsOneRow(nextFits)
    }
  }, [innerRef, modeRef, captureFlipFrom, setFitsOneRow, bandActiveRef])

  // Not on `mode`: the pass forces both display modes itself, so its reads do
  // not depend on the one on screen, and re-running it on a flip would resolve
  // the caption fade it measures through (see `data-dock-measuring`).
  useLayoutEffect(() => {
    measure()
  }, [measure, contextKey])

  return { rowH, iconH, expH, draggingRef, measureDirtyRef, endpointsRef, measure }
}

/**
 * Display-change FLIP: snapshot the tools' boxes, glide them from where they
 * were to where they land, and fade in the ones a flip uncovers. Raw WAAPI,
 * not Motion, so an interrupted flip reverts to CSS cleanly (see `flipTool`).
 */
function useDockFlipAnimation({
  innerRef,
  reduceRef,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>
  reduceRef: React.RefObject<boolean | null>
}) {
  /** The fade viewport the tools row (or the expanded list) scrolls in. */
  const rowScroller = useCallback(() => innerRef.current?.parentElement ?? null, [innerRef])

  /**
   * The clip the tools are seen through: the row scrolls in it horizontally,
   * the wrapped list vertically. A tool outside it is not on screen even
   * though it has a layout box.
   */
  const toolsView = useCallback((): FlipBox | null => {
    const r = rowScroller()?.getBoundingClientRect()
    return r ? flipBox(r) : null
  }, [rowScroller])

  /** In-flight display-flip animations, keyed by tool button. */
  const flipAnimsRef = useRef(new Map<HTMLElement, FlipAnims>())
  /** Boxes captured just before the flip being committed (see `captureFlipFrom`). */
  const flipFromRef = useRef<Map<HTMLElement, FlipFrom> | null>(null)
  /** Bumped per flip so a stale animation's cleanup cannot touch a newer one. */
  const flipRunRef = useRef(0)

  /**
   * Snapshot every tool's on-screen box just before a display flip (see
   * `playFlip`). The box is the visual one, transform included, so an
   * interrupted flip resumes from what the user is looking at, not its target.
   */
  const captureFlipFrom = useCallback(() => {
    const el = innerRef.current
    const view = toolsView()
    if (!el || !view)
      return
    const from = new Map<HTMLElement, FlipFrom>()
    for (const child of el.children) {
      const h = child as HTMLElement
      const box = flipBox(h.getBoundingClientRect())
      const translate = parseTranslate(getComputedStyle(h).transform)
      from.set(h, { box, translate, visible: isBoxVisible(box, view) })
    }
    flipFromRef.current = from
  }, [innerRef, toolsView])

  /**
   * Stop a flip that is still running and read what it was showing, so the next
   * one can start there. Clears the transforms too: the rect math below (the
   * row anchor) must see final layout boxes, never a mid-animation one.
   */
  const detachFlip = useCallback((): Map<HTMLElement, FlipDetach> => {
    const carry = new Map<HTMLElement, FlipDetach>()
    const el = innerRef.current
    flipRunRef.current++
    if (el) {
      for (const child of el.children) {
        const h = child as HTMLElement
        const cs = getComputedStyle(h)
        carry.set(h, { translate: parseTranslate(cs.transform), opacity: Number(cs.opacity) })
      }
    }
    stopFlips(flipAnimsRef.current)
    if (el) {
      for (const child of el.children) {
        const h = child as HTMLElement
        h.style.transform = ''
        h.style.opacity = ''
      }
    }
    return carry
  }, [innerRef])

  /** Put every tool back at rest: no flip transform, no inline opacity. */
  const settleFlip = useCallback(() => {
    flipRunRef.current++
    stopFlips(flipAnimsRef.current)
    const el = innerRef.current
    if (!el)
      return
    for (const child of el.children) {
      const h = child as HTMLElement
      h.style.transform = ''
      h.style.opacity = ''
    }
  }, [innerRef])

  /**
   * FLIP the tools into the display that just committed: each button starts on
   * the box it was showing (a transform) and glides to its new one, and a tool
   * the flip uncovers fades in as it arrives. Called after `restoreRowAnchor`,
   * so the target boxes already include the restored row scroll. Reduced motion
   * skips it: the commit is the end state.
   */
  const playFlip = useCallback((carry: Map<HTMLElement, FlipDetach>) => {
    const el = innerRef.current
    const from = flipFromRef.current
    flipFromRef.current = null
    const view = toolsView()
    if (!el || !from || !view || reduceRef.current) {
      settleFlip()
      return
    }
    const run = flipRunRef.current
    // Read the targets and resting opacities first: no animation starts (a
    // style write) until every rect is known, so one layout pass does it all.
    const targets = [...el.children].map(child => ({
      h: child as HTMLElement,
      to: flipBox(child.getBoundingClientRect()),
      // After `detachFlip` the computed opacity is the resting one again: the
      // disabled tools sit below 1 and the fade must land there (see flipTool).
      base: Number(getComputedStyle(child).opacity),
    }))
    for (const { h, to, base } of targets) {
      const was = from.get(h)
      if (!was)
        continue
      const anims = flipTool(h, { from: was, seen: carry.get(h), to, view, base })
      if (!anims)
        continue
      flipAnimsRef.current.set(h, anims)
      const done = () => {
        if (flipRunRef.current === run)
          flipAnimsRef.current.delete(h)
      }
      if (anims.move)
        anims.move.onfinish = done
      if (anims.fade)
        anims.fade.onfinish = done
    }
  }, [innerRef, reduceRef, settleFlip, toolsView])

  return { rowScroller, captureFlipFrom, detachFlip, settleFlip, playFlip }
}

/**
 * The band's interruption contract (see `useDockBand`): a child-list change
 * while the field is live leaves every endpoint stale, so the band settles at
 * once instead of animating against boxes its tools no longer occupy. The
 * swap ghost (lib/dockSwap) is already the animation for that event, so the
 * settle replays nothing. Measure-driven interruptions do not need this: the
 * measure pass refuses to run mid-band and the band settles before it does.
 */
function useDockBandInterrupt({
  innerRef,
  activeRef,
  settle,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>
  activeRef: React.RefObject<boolean>
  settle: () => void
}) {
  const settleRef = useRef(settle)
  useLayoutEffect(() => {
    settleRef.current = settle
  })
  useEffect(() => {
    const el = innerRef.current
    if (!el)
      return
    const mo = new MutationObserver((records) => {
      if (!activeRef.current)
        return
      const swapped = records.some(r => r.type === 'childList' && r.target === el)
      if (swapped)
        settleRef.current()
    })
    mo.observe(el, { childList: true })
    return () => mo.disconnect()
  }, [activeRef, innerRef])
}

/**
 * The band progress the geometry and the sheet position read, or null when
 * there is no band to serve: a dock without both displays, or a degenerate
 * pair. `dockDisplayAt` takes the same branch for the display rule.
 */
function bandAt(geom: DockGeometry, pos: number): number | null {
  const iRow = geom.order.indexOf('row')
  const iExp = geom.order.indexOf('expanded')
  if (iRow < 0 || iExp < 0)
    return null
  const lower = geom.heights[iRow]!
  const upper = geom.heights[iExp]!
  if (upper - lower < 1)
    return null
  return bandProgress(geom.toolsMaxH - pos, lower, upper)
}

/** One tool's place in the band: its displacement and the fade it enters on. */
interface BandItem {
  /** The displacement from this tool's row box to its wrapped box, px. */
  readonly dx: number
  readonly dy: number
  readonly slot: BandSlot
  /** The share of the tool's row box the row scroller clipped at capture, 0..1. */
  readonly clip: number
  /** Resting opacity: disabled tools sit below 1, and the fade lands there. */
  readonly base: number
  el: HTMLElement
  /** The last translate written, so a still frame writes nothing. */
  wrote: string
  /** The last opacity written, '' while the CSS value stands. */
  faded: string
}

/** The displacement field: the base layout and every tool's move over it. */
interface BandField {
  readonly base: 'row' | 'expanded'
  readonly items: readonly BandItem[]
}

/**
 * Write one tool's frame. Over the row base it moves by `D·t`; over the
 * wrapped base it starts at `D·(t − 1)`, which is the row box, and decays to
 * zero at the wrapped one. A value equal to the last write is skipped, so a
 * still frame touches no style at all.
 */
function writeBandItem(item: BandItem, base: BandField['base'], t: number) {
  const u = base === 'row' ? t : t - 1
  const translate = `${(item.dx * u).toFixed(2)}px ${(item.dy * u).toFixed(2)}px`
  if (translate !== item.wrote) {
    item.wrote = translate
    item.el.style.translate = translate
  }
  // Only a tool the row scroller clipped at capture fades: it enters from its
  // clipped fraction and lands on its resting opacity, which is below 1 for a
  // disabled tool. Every other tool's opacity is the CSS value, so the inline
  // one is cleared rather than written.
  const opacity = item.clip < 1 ? String(item.clip + (item.base - item.clip) * t) : ''
  if (opacity !== item.faded) {
    item.faded = opacity
    item.el.style.opacity = opacity
  }
}

/**
 * The displacement field between the labelled row and the wrapped display
 * (lib/dockBand). It owns one thing on the tool buttons, `style.translate`,
 * and nothing else: `transform` and `opacity` belong to the flip, the reorder
 * glide's transform composes with it additively, and press uses `scale`, so
 * the band and the existing animations can never fight over the same pixels.
 *
 * Positions are `D_k · u_k(p)`, a pure function of the `y` motion value, so a
 * drag, a release spring, a tap and a reversal all get the same cascade with no
 * animation state to interrupt. The field is built once per band entry (and
 * once per base swap), never per frame: a frame is O(N) arithmetic and O(N)
 * style writes, zero DOM reads, zero React renders.
 */
function useDockBand({
  y,
  innerRef,
  rowScroller,
  geomRef,
  modeRef,
  endpointsRef,
  rowScrollRef,
  reduceRef,
  activeRef,
  measureDirtyRef,
  measure,
}: {
  y: MotionValue<number>
  innerRef: React.RefObject<HTMLDivElement | null>
  rowScroller: () => HTMLElement | null
  geomRef: React.RefObject<DockGeometry>
  modeRef: React.RefObject<ToolsDockMode>
  endpointsRef: React.RefObject<DockEndpoints>
  /** The row scroll a band draws while its base is the wrapped layout. */
  rowScrollRef: React.RefObject<number | null>
  reduceRef: React.RefObject<boolean | null>
  /** The band is in flight: the measure pass and the press hand-off read it. */
  activeRef: React.RefObject<boolean>
  measureDirtyRef: React.RefObject<boolean>
  measure: () => void
}) {
  const [active, setActive] = useState(false)
  const fieldRef = useRef<BandField | null>(null)
  // `exit` may run a measure that skipped while the band held the list; the
  // callback is refreshed every render so the subscription never goes stale.
  const measureRef = useRef(measure)
  useLayoutEffect(() => {
    measureRef.current = measure
  })

  /**
   * Build the field against the committed display. Every read here is an entry
   * or base-swap read; the per-frame path allocates nothing and reads nothing.
   */
  const build = useCallback((prev: BandField | null = null): BandField | null => {
    const el = innerRef.current
    const m = modeRef.current
    if (!el || (m !== 'row' && m !== 'expanded'))
      return null
    const endpoints = endpointsRef.current
    const picked: { el: HTMLElement, boxes: DockToolBoxes }[] = []
    for (const child of el.children) {
      const h = child as HTMLElement
      const boxes = endpoints.get(h)
      if (boxes)
        picked.push({ el: h, boxes })
    }
    if (picked.length === 0)
      return null
    // Visual order, not DOM order: disabled tools sort last via CSS `order`,
    // so a DOM-order cascade would look shuffled whenever a tool disables.
    picked.sort((a, b) => a.boxes.row.x - b.boxes.row.x || a.boxes.row.y - b.boxes.row.y)
    const slots = bandSchedule(picked.length)
    // The row's scroll is absorbed into D: at the row end the field carries
    // the scrolled appearance, at the wrapped end the term has decayed away.
    const scroller = rowScroller()
    const s0 = m === 'row' ? (scroller?.scrollLeft ?? 0) : (rowScrollRef.current ?? 0)
    const container = el.getBoundingClientRect()
    const view = scroller?.getBoundingClientRect()
    // Resting opacities are read once per tool and carried across a base swap:
    // `getComputedStyle` returns the field's own inline fade while one is
    // written, so re-reading it on every rebuild would ratchet a clipped tool
    // toward transparent.
    const baseOf = (h: HTMLElement) => {
      const carried = prev?.items.find(item => item.el === h)
      return carried ? carried.base : (Number(getComputedStyle(h).opacity) || 1)
    }
    const items = picked.map(({ el: h, boxes }, i) => {
      const width = h.offsetWidth || 1
      let clip = 1
      if (view) {
        // The container is the scrolled content, so its rect already carries
        // the row's scroll: the box's viewport left is the sum, not minus `s0`.
        const left = container.left + boxes.row.x
        const overlap = Math.min(left + width, view.right) - Math.max(left, view.left)
        clip = Math.min(1, Math.max(0, overlap / width))
      }
      return {
        el: h,
        dx: boxes.wrap.x - boxes.row.x + s0,
        dy: boxes.wrap.y - boxes.row.y,
        slot: slots[i]!,
        clip,
        base: baseOf(h),
        wrote: '',
        faded: '',
      }
    })
    return { base: m, items }
  }, [endpointsRef, innerRef, modeRef, rowScrollRef, rowScroller])

  /** Drop the field: every translate and fade back to the layout's own. */
  const exit = useCallback(() => {
    const field = fieldRef.current
    if (field) {
      for (const item of field.items) {
        item.el.style.translate = ''
        item.el.style.opacity = ''
        item.el.style.willChange = ''
      }
      fieldRef.current = null
    }
    if (activeRef.current) {
      activeRef.current = false
      setActive(false)
    }
    // A measure that ran mid-band was deferred: the list is free now, and the
    // field's boxes are gone, so the pass cannot tear anything apart.
    if (measureDirtyRef.current) {
      measureDirtyRef.current = false
      measureRef.current()
    }
  }, [activeRef, measureDirtyRef])

  /** Enter the band: the one read pass, then the promoted layers. */
  const enter = useCallback((): boolean => {
    // An entry over the row base reads its live scroll. An entry over the
    // wrapped base cannot (that list does not scroll horizontally), so the
    // field draws the memory the last row exit left; the band commit that
    // brought it here read it before the class swap clamped it.
    if (modeRef.current === 'row')
      rowScrollRef.current = rowScroller()?.scrollLeft ?? 0
    const field = build()
    if (!field)
      return false
    for (const item of field.items)
      item.el.style.willChange = 'transform'
    fieldRef.current = field
    activeRef.current = true
    setActive(true)
    return true
  }, [activeRef, build, modeRef, rowScrollRef, rowScroller])

  /** Project the field at the current `y`; enter or leave the band at its ends. */
  const update = useCallback(() => {
    const p = bandAt(geomRef.current, y.get())
    // No band to serve: reduced motion, a dock without both displays, or a
    // degenerate pair. `dockDisplayAt` takes the same branch for the display.
    if (p == null || reduceRef.current)
      return exit()
    const m = modeRef.current
    // The committed display decides which half of the band can be in flight:
    // over the row base the field grows with `p`, over the wrapped base it
    // shrinks, so each end is exited where its translate is already zero.
    if (m !== 'row' && m !== 'expanded')
      return exit()
    if (m === 'row' ? p <= 0 : p >= 1)
      return exit()
    if (!activeRef.current && !enter())
      return
    const field = fieldRef.current
    if (!field)
      return
    for (const item of field.items)
      writeBandItem(item, field.base, bandPush(item.slot, p))
  }, [activeRef, enter, exit, geomRef, modeRef, reduceRef, y])

  /**
   * Re-project after a display commit (band pairs only), before paint. The
   * transforms are recomputed against the new base, so the base swap is a
   * change of representation rather than a move: the screen is continuous.
   */
  const sync = useCallback(() => {
    if (!activeRef.current)
      return update()
    const scroller = rowScroller()
    if (modeRef.current === 'row' && scroller) {
      // The class swap clamped the offset; the content width is back, so the
      // remembered raw scroll lands again. Re-read it: the clamp is the truth.
      if (rowScrollRef.current != null && scroller.scrollLeft !== rowScrollRef.current)
        scroller.scrollLeft = rowScrollRef.current
      rowScrollRef.current = scroller.scrollLeft
    }
    // The base and the scroll both moved, so the field is rebuilt against the
    // new layout; `build` starts every item's `wrote` empty, so the first frame
    // of the new base writes its own numbers rather than reusing the old ones.
    fieldRef.current = build(fieldRef.current)
    update()
  }, [activeRef, build, modeRef, rowScrollRef, rowScroller, update])

  // One subscription, for every writer of `y`: the drag, the release spring,
  // the tap tween and a reversal all scrub the same field. The cleanup is the
  // unmount path: drop the styles and the field, with no state write to an
  // unmounting sheet.
  useEffect(() => {
    const off = y.on('change', update)
    return () => {
      off()
      const field = fieldRef.current
      if (!field)
        return
      for (const item of field.items) {
        item.el.style.translate = ''
        item.el.style.opacity = ''
        item.el.style.willChange = ''
      }
      fieldRef.current = null
      activeRef.current = false
    }
  }, [activeRef, update, y])

  // Stable across renders: the sheet's display-commit layout effect names this
  // object in its deps, and a fresh one per render would replay the FLIP.
  return useMemo(() => ({ active, activeRef, sync, exit }), [active, activeRef, exit, sync])
}

/**
 * The tool list's observers, all DOM-driven because route content portals in
 * without re-rendering the sheet: reorder glide, list swap, and a re-measure
 * on any change.
 */
function useDockToolList({
  innerRef,
  measure,
  settleFlip,
  reduceRef,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>
  measure: () => void
  settleFlip: () => void
  reduceRef: React.RefObject<boolean | null>
}) {
  useEffect(() => {
    const el = innerRef.current
    if (!el)
      return
    // FLIP: tools sort available-first via CSS `order` (disabled → order 1),
    // so a precondition flip moves buttons. Remember each tool's layout box
    // (offsetLeft/Top ignore in-flight transforms) and glide from the old box
    // with a Motion spring whenever a tool's disabled state changes.
    const boxes = new WeakMap<Element, { x: number, y: number }>()
    const snapshot = () => {
      for (const c of el.children) {
        const h = c as HTMLElement
        boxes.set(c, { x: h.offsetLeft, y: h.offsetTop })
      }
    }
    snapshot()

    // List swap (see lib/dockSwap). Every swap point (a route portaling a
    // different tool set in, the label tools mounting, focus adding a tool)
    // lands as a direct-child change of `el`: the outgoing list is ghosted
    // above the live one and both slide rightward.
    const scrollerOf = () => el.parentElement
    /** The container's children before this batch ('' = nothing to swap with). */
    let prevHtml = el.innerHTML
    /** The whole scroller before this batch: classes and inline fade mask included. */
    let prevScroller = scrollerOf()?.innerHTML ?? ''
    let swapAt = Number.NEGATIVE_INFINITY
    let swapRun = 0
    let swapAnim: ReturnType<typeof animate> | null = null
    let ghostEl: HTMLElement | null = null
    /** Drop the ghost and put the live row back at rest (also the unmount hook). */
    const settleSwap = () => {
      swapAnim?.stop()
      swapAnim = null
      ghostEl?.remove()
      ghostEl = null
      const scroller = scrollerOf()
      if (scroller) {
        scroller.style.transform = ''
        scroller.style.opacity = ''
      }
    }
    /** Incoming list slides in from the right, outgoing slides out to the right. */
    const playSwap = (plan: DockSwapPlan) => {
      const scroller = scrollerOf()
      const host = scroller?.parentElement
      if (!scroller || !host)
        return
      settleSwap()
      const run = ++swapRun
      const done = () => {
        if (run === swapRun)
          settleSwap()
      }
      if (plan.ghost && prevScroller) {
        const ghost = scroller.cloneNode(false) as HTMLElement
        ghost.innerHTML = prevScroller
        ghost.setAttribute('data-dock-swap-ghost', '')
        ghost.setAttribute('aria-hidden', 'true')
        ghost.setAttribute('inert', '')
        // The snapshot repeats the live list's ids (popover anchors,
        // aria-controls): drop them so the real buttons keep them.
        for (const n of ghost.querySelectorAll<HTMLElement>('[id]')) n.removeAttribute('id')
        Object.assign(ghost.style, {
          position: 'absolute',
          inset: '0',
          margin: '0',
          pointerEvents: 'none',
          willChange: 'transform, opacity',
        })
        host.append(ghost)
        // After insertion, or the box has no scroll range yet to clamp to.
        ghost.scrollLeft = scroller.scrollLeft
        ghost.scrollTop = scroller.scrollTop
        ghostEl = ghost
      }
      if (plan.enter) {
        swapAnim = animate(scroller, { x: [DOCK_SWAP_PX, 0], opacity: [0, 1] }, { duration: DOCK_SWAP_S, ease: DOCK_SWAP_EASE })
        void swapAnim.then(done)
      }
      if (ghostEl)
        void animate(ghostEl, { x: [0, DOCK_SWAP_PX], opacity: [1, 0] }, { duration: DOCK_SWAP_S, ease: DOCK_SWAP_EASE }).then(done)
    }

    /**
     * Only the container's own children are the tool list: a button's internals
     * (icon morphs, captions) must not read as a swap.
     */
    const maybeSwap = (records: MutationRecord[]) => {
      const swapped = records.some(r => r.type === 'childList' && r.target === el
        && [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === Node.ELEMENT_NODE))
      if (swapped) {
        const plan = planDockSwap({
          hadContent: prevHtml !== '',
          midSwap: performance.now() - swapAt < DOCK_SWAP_PAIR_MS,
          reduce: !!reduceRef.current,
        })
        if (plan.ghost || plan.enter) {
          swapAt = performance.now()
          playSwap(plan)
        }
      }
      prevHtml = el.innerHTML
      prevScroller = scrollerOf()?.innerHTML ?? ''
    }

    const mo = new MutationObserver((records) => {
      const reorder = records.some(r => r.type === 'attributes' && r.target.parentElement === el)
      if (reorder && !reduceRef.current) {
        for (const c of el.children) {
          const h = c as HTMLElement
          const prev = boxes.get(c)
          const dx = prev ? prev.x - h.offsetLeft : 0
          const dy = prev ? prev.y - h.offsetTop : 0
          if (dx || dy)
            animate(h, { x: [dx, 0], y: [dy, 0] }, SPRING)
        }
      }
      maybeSwap(records)
      snapshot()
      measure()
    })
    mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'data-disabled'] })
    const ro = new ResizeObserver(() => {
      snapshot()
      measure()
    })
    if (el.parentElement)
      ro.observe(el.parentElement)
    const onResize = () => {
      snapshot()
      measure()
    }
    window.addEventListener('resize', onResize)
    return () => {
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      settleSwap()
      settleFlip()
    }
  }, [innerRef, measure, reduceRef, settleFlip])
}

/**
 * The sheet's transform and its drag-driven tint. Both follow one motion
 * value, so a drag costs no React render per frame.
 */
function useDockPopupTransform({
  y,
  liquidOn,
  geomRef,
}: {
  y: MotionValue<number>
  liquidOn: boolean
  geomRef: React.RefObject<DockGeometry>
}) {
  return useCallback((el: HTMLDivElement | null) => {
    if (!el)
      return
    // Drag-driven tint: the visible tools height → --dock-drag-fade.
    let last = ''
    const sync = (v: number) => {
      const { toolsMaxH: max, rowH: rh } = geomRef.current
      const f = String(dockDragFade(max, v, rh, HANDLE_H))
      if (f !== last) {
        last = f
        el.style.setProperty('--dock-drag-fade', f)
      }
    }
    const move = (v: number) => {
      // The sheet is bottom-anchored (its bottom edge is the footer's top, see
      // the clip above): `y` is only ever the distance below the largest snap.
      // A negative one (a spring overshoot on an upward flick) must not lift
      // the sheet and show the board through the clip.
      el.style.transform = `translateY(${Math.max(0, v)}px)`
      sync(v)
    }
    move(y.get())
    const off = y.on('change', move)
    const glass = liquidOn ? liquidGlassRef(el) : undefined
    return () => {
      off()
      glass?.()
    }
  }, [geomRef, liquidOn, y])
}

/** The whole-sheet drag: press, slop, scroller hand-off, mode crossing, snap. */
function useDockGesture({
  hidden,
  wrap,
  y,
  dragRef,
  geomRef,
  modeRef,
  order,
  cap,
  reduce,
  commitDisplay,
  measure,
  draggingRef,
  measureDirtyRef,
  pendingVelRef,
  bandActiveRef,
}: {
  hidden: boolean
  wrap: boolean
  y: MotionValue<number>
  dragRef: React.RefObject<DockDrag | null>
  geomRef: React.RefObject<DockGeometry>
  modeRef: React.RefObject<ToolsDockMode>
  order: readonly ToolsDockMode[]
  cap: DockCapacity
  reduce: boolean | null
  commitDisplay: (next: ToolsDockMode) => void
  measure: () => void
  draggingRef: React.RefObject<boolean>
  measureDirtyRef: React.RefObject<boolean>
  pendingVelRef: React.RefObject<number>
  /** The band owns the pointer's presses while it is in flight (see lib/dockPhysics). */
  bandActiveRef: React.RefObject<boolean>
}) {
  const suppressClickRef = useRef(false)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || hidden)
      return
    // The whole sheet is a grab surface; only a scroller that can still move
    // in the drag's direction keeps the gesture (see lib/dockPhysics).
    const scroller = (e.target as HTMLElement).closest<HTMLElement>('[data-dock-fade]')
    dragRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: y.get(),
      active: false,
      horizontal: wrap ? false : !!scroller,
      list: wrap && scroller
        ? { scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight }
        : null,
      startIdx: nearestSnapIndex(geomRef.current.offsets, y.get()),
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId)
      return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.active) {
      if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP)
        return
      // A horizontal swipe in the tools row scrolls it; a vertical one in a
      // list that can still move scrolls the list. Everything else drags the
      // drawer, which then owns the pointer (data-swiping). A frozen list (the
      // band is in flight) never owns it: see `DragSurface.frozen`.
      if (dragOwner({ horizontal: d.horizontal, list: d.list, frozen: bandActiveRef.current }, dx, dy) === 'scroller') {
        dragRef.current = null
        return
      }
      d.active = true
      d.start = y.get()
      y.stop()
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.setAttribute('data-swiping', '')
    }
    const { offsets: offs, toolsMaxH: maxH, order: modes, heights } = geomRef.current
    const next = dampOffset(d.start + dy, Math.min(...offs), Math.max(...offs))
    y.set(next)
    // The content follows the pointer: icons against row settle at their
    // midpoint, row against expanded at the band edges. One state update per
    // crossing, never per frame. Only a pointer move asks the latch; taps and
    // releases commit their own answer (see `dockDisplayAt`).
    commitDisplay(dockDisplayAt({
      order: modes,
      heights,
      liveH: maxH - next,
      prev: modeRef.current,
      reduce: !!reduce,
    }))
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId)
      return
    dragRef.current = null
    if (!d.active)
      return
    suppressClickRef.current = true
    // The lists take the pointer back: their native scroll resumes at rest.
    e.currentTarget.removeAttribute('data-swiping')
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    draggingRef.current = false
    // Whatever the drag deferred (a route swap, a precondition flip): the sheet
    // is at rest now, so the pass can run against it.
    if (measureDirtyRef.current) {
      measureDirtyRef.current = false
      measure()
    }
    const { offsets: offs, offset: cur } = geomRef.current
    const velocity = e.type === 'pointercancel' ? 0 : y.getVelocity()
    // The release names the snap with the drawer's existing fling rule, from
    // the snap the gesture began on: the display on screen lags the band by
    // design (see `dockDisplayAt`), so it cannot be the flick's origin.
    const from = modeRef.current
    const idx = pickSnap(offs, y.get(), velocity, d.startIdx)
    const next = dockTransition(from, { type: 'snap', mode: order[idx]! }, cap)
    if (next === from) {
      animate(y, cur, reduce ? { duration: 0 } : { ...SPRING, velocity })
    }
    else {
      pendingVelRef.current = velocity
      commitDisplay(next)
    }
  }

  return { onPointerDown, onPointerMove, endDrag, suppressClickRef }
}

function DockSheet({ hidden, contextKey, innerRef: setInner }: {
  hidden: boolean
  contextKey: string
  innerRef: (el: HTMLDivElement | null) => void
}) {
  const t = useT()
  const storedMode = useStore(s => s.toolsDockMode)
  const setMode = useStore(s => s.setToolsDockMode)
  const dockBg = useStore(s => s.dockBg)
  const dockOpacity = useStore(s => s.dockOpacity)

  const innerRef = useRef<HTMLDivElement | null>(null)

  const reduce = useReducedMotion()
  const reduceRef = useRef(reduce)
  useLayoutEffect(() => {
    reduceRef.current = reduce
  })

  const [fitsOneRow, setFitsOneRow] = useState(true)
  const cap = useMemo<DockCapacity>(() => ({ fitsOneRow }), [fitsOneRow])
  const mode = clampDockMode(storedMode, cap)
  const order = dockModes(cap)
  /** The display on screen, readable from a pointer handler mid-gesture. */
  const modeRef = useRef(mode)
  const { rowScroller, captureFlipFrom, detachFlip, settleFlip, playFlip } = useDockFlipAnimation({ innerRef, reduceRef })
  /**
   * The display band owns the list's transforms: the measure pass may not
   * restyle the content under them (see `useDockMeasure`). Owned by
   * `useDockBand` once it exists; declared here because the measure hook is
   * constructed first and reads it.
   */
  const bandActiveRef = useRef(false)
  const { rowH, iconH, expH, draggingRef, measureDirtyRef, endpointsRef, measure } = useDockMeasure({
    innerRef,
    contextKey,
    storedMode,
    modeRef,
    fitsOneRow,
    setFitsOneRow,
    captureFlipFrom,
    bandActiveRef,
  })
  useLayoutEffect(() => {
    modeRef.current = mode
  }, [mode])

  // Reduced motion: a flip is instant, and a glide still in flight when it is
  // switched on stops where it is (the commit is the final layout).
  useLayoutEffect(() => {
    if (reduce)
      settleFlip()
  }, [reduce, settleFlip])

  const wrap = mode === 'expanded'
  const scrollRef = useScrollFade<HTMLDivElement>(wrap ? 'y' : 'x')

  // One snap per display, in tap-cycle order: the icon row, the labelled row,
  // the wrapped multi-row. Icons and labels are two heights of the same single
  // row, so the sheet's resting heights differ by the captions.
  const snapPoints = order.map(m => HANDLE_H + (m === 'icons' ? iconH : m === 'row' ? rowH : expH))
  const snapPoint = snapPoints[order.indexOf(mode)] ?? snapPoints.at(-1)!
  const toolsMaxH = Math.max(...snapPoints)

  useDockToolList({ innerRef, measure, settleFlip, reduceRef })

  const attachInner = useCallback((el: HTMLDivElement | null) => {
    innerRef.current = el
    setInner(el)
  }, [innerRef, setInner])

  // A flip swaps every caption, so the row's content width changes and the
  // browser clamps scrollLeft on the next layout. Remember the tool at the
  // row's left edge and put it back after the flip (kept across an expanded
  // flip, which cannot scroll).
  const anchorRef = useRef<{ el: HTMLElement, dx: number } | null>(null)
  /** Snapshot the leading tool; skipped where the row does not scroll. */
  const saveRowAnchor = useCallback(() => {
    const el = innerRef.current
    const scroller = rowScroller()
    if (!el || !scroller || scroller.scrollWidth <= scroller.clientWidth + 1)
      return
    const left = scroller.getBoundingClientRect().left
    for (const child of el.children) {
      // Subtract an in-flight flip's translate: the anchor is a layout offset,
      // and a tool interrupted mid-glide still reports its transform here.
      const t = parseTranslate(getComputedStyle(child).transform)
      const r = child.getBoundingClientRect()
      if (r.right - t.x > left + 1) {
        // Screen offset: the row's scroll position at save time is not part of
        // it, so a clamp in between (the wrapped list cannot scroll) is undone.
        anchorRef.current = { el: child as HTMLElement, dx: r.left - t.x - left }
        return
      }
    }
  }, [innerRef, rowScroller])
  /** Re-scroll so the anchored tool sits `dx` into the row's left edge again. */
  const restoreRowAnchor = useCallback(() => {
    const anchor = anchorRef.current
    const scroller = rowScroller()
    if (!anchor || !scroller || !anchor.el.isConnected || scroller.scrollWidth <= scroller.clientWidth + 1)
      return
    const left = scroller.getBoundingClientRect().left
    const want = anchor.el.getBoundingClientRect().left - left - anchor.dx
    anchorRef.current = null
    if (Math.abs(want) >= 1)
      scroller.scrollLeft += want
  }, [rowScroller])

  // Sheet position is one motion value: px below fully open (0 = largest
  // snap). Drags write it directly (rubber-banded past the end snaps);
  // releases and mode changes spring it to the snap with the release
  // velocity. No React re-render per frame.
  const offsets = snapPoints.map(sp => toolsMaxH - sp)
  const offset = toolsMaxH - snapPoint
  const y = useMotionValue(offset)
  const pendingVelRef = useRef(0)
  const dragRef = useRef<DockDrag | null>(null)
  const geomRef = useRef<DockGeometry>({ toolsMaxH, rowH, order, heights: snapPoints, offsets, offset })
  useLayoutEffect(() => {
    geomRef.current = { toolsMaxH, rowH, order, heights: snapPoints, offsets, offset }
  })

  /** The row scroll a band draws while its base is the wrapped layout. */
  const rowScrollRef = useRef<number | null>(null)
  /**
   * A band-crossing tap owns `y`'s travel (see `goTo`): the settle effect must
   * not restart it, or the cascade would run at the spring's pace instead.
   */
  const bandTweenRef = useRef(false)
  const band = useDockBand({
    y,
    innerRef,
    rowScroller,
    geomRef,
    modeRef,
    endpointsRef,
    rowScrollRef,
    reduceRef,
    activeRef: bandActiveRef,
    measureDirtyRef,
    measure,
  })
  /**
   * The commit left a band pair behind: the layout effect below re-projects
   * the field instead of playing a FLIP. One flag, consumed once.
   */
  const pendingBandRef = useRef(false)
  /**
   * The driver's stable methods, read by the commit paths. Calling them from a
   * ref keeps those paths off `band`, whose `active` flips on every band edge:
   * an effect keyed on it would replay the FLIP at each edge.
   */
  const bandRef = useRef(band)
  useLayoutEffect(() => {
    bandRef.current = band
  })

  /**
   * The one writer of the display (drag crossing, release snap, tap, Escape).
   * Setting the display already on screen is a no-op, so a drag may call it
   * every frame.
   *
   * A band pair needs no FLIP: the field is already showing the continuous
   * position, so the commit only swaps the base under it. Everything else
   * captures the boxes the tools show now and glides them (`playFlip`).
   * Ordering matters twice: the field's translate must be cleared after
   * `captureFlipFrom` (the start box is what is on screen) and before
   * `saveRowAnchor` (the anchor reads layout), and the row scroll must be read
   * before `setMode`, whose class swap clamps it.
   */
  const commitDisplay = useCallback((next: ToolsDockMode) => {
    if (next === modeRef.current)
      return
    const from = modeRef.current
    const bandPair = isBandTransition(from, next) && order.includes('expanded')
    if (!bandPair && !reduceRef.current)
      captureFlipFrom()
    if (!bandPair)
      bandRef.current.exit()
    if (bandPair && from === 'row')
      rowScrollRef.current = rowScroller()?.scrollLeft ?? null
    if (!bandPair)
      saveRowAnchor()
    modeRef.current = next
    pendingBandRef.current = bandPair
    setMode(next)
  }, [captureFlipFrom, modeRef, order, reduceRef, rowScroller, saveRowAnchor, setMode])
  // Commits before paint. Either way any flip still in flight is detached (a
  // band commit never plays a carry: the field is the continuous position);
  // a band pair re-projects, and any other pair restores the anchor and glides.
  useLayoutEffect(() => {
    const carry = detachFlip()
    const wasBand = pendingBandRef.current
    pendingBandRef.current = false
    if (wasBand) {
      bandRef.current.sync()
      return
    }
    restoreRowAnchor()
    playFlip(carry)
  }, [mode, detachFlip, restoreRowAnchor, playFlip])

  // The band's exit restores the raw row scroll once, before paint: a rollback
  // clears the transforms while the scroller still holds the wrapped width, and
  // the class swap lands in the same commit, so the row never flashes at its
  // start. Distinct from the anchor above, a width change's offset.
  useLayoutEffect(() => {
    if (band.active || mode !== 'row' || rowScrollRef.current == null)
      return
    const scroller = rowScroller()
    if (scroller && scroller.scrollLeft !== rowScrollRef.current)
      scroller.scrollLeft = rowScrollRef.current
  }, [band.active, mode, rowScroller])

  /**
   * The band's interruption exit: commit the display the live height is
   * nearest, then drop the field and put `y` on that snap. Committing first
   * means the sheet already holds the layout that snap shows, so clearing the
   * transforms moves nothing on screen. Idempotent: with no field in flight it
   * is a plain settle to the snap.
   */
  const settleBand = useCallback(() => {
    const { offsets: offs, order: modes } = geomRef.current
    const idx = nearestSnapIndex(offs, y.get())
    const target = modes[idx] ?? dockModeAtHeight(modes, geomRef.current.heights, geomRef.current.toolsMaxH - y.get())
    commitDisplay(dockTransition(modeRef.current, { type: 'snap', mode: target }, cap))
    bandRef.current.exit()
    y.jump(offs[idx] ?? geomRef.current.offset)
  }, [cap, commitDisplay, geomRef, modeRef, y])

  // A tool list change mid-band leaves every endpoint stale, and a preference
  // that drops the band mid-flight leaves the field with nothing to project:
  // both settle to the nearest display at once (the swap ghost covers the
  // change itself).
  useDockBandInterrupt({ innerRef, activeRef: bandActiveRef, settle: settleBand })
  useLayoutEffect(() => {
    if (reduce && band.active)
      settleBand()
  }, [reduce, band.active, settleBand])

  const surface = dockSurface(dockBg, dockOpacity)

  // Settle on mode / geometry change. Content-driven geometry (route switch,
  // wrap change) jumps: the user's mode didn't change, so nothing slides.
  const lastGeomRef = useRef({ toolsMaxH, mode })
  useLayoutEffect(() => {
    const prev = lastGeomRef.current
    lastGeomRef.current = { toolsMaxH, mode }
    // A band tap's duration tween started before this render and reaches the
    // `offset` below by construction: leave it running.
    if (bandTweenRef.current) {
      bandTweenRef.current = false
      return
    }
    if (dragRef.current?.active)
      return
    const velocity = pendingVelRef.current
    pendingVelRef.current = 0
    if (reduce || (prev.toolsMaxH !== toolsMaxH && prev.mode === mode)) {
      y.jump(offset)
      return
    }
    const anim = animate(y, offset, { ...SPRING, velocity })
    return () => anim.stop()
  }, [offset, toolsMaxH, mode, reduce, y])

  const liquidOn = dockBg === 'liquid'
  const popupRef = useDockPopupTransform({ y, liquidOn, geomRef })
  const { onPointerDown, onPointerMove, endDrag, suppressClickRef } = useDockGesture({
    hidden,
    wrap,
    y,
    dragRef,
    geomRef,
    modeRef,
    cap,
    order,
    reduce,
    commitDisplay,
    measure,
    draggingRef,
    measureDirtyRef,
    pendingVelRef,
    bandActiveRef,
  })

  /**
   * A display the user asked for directly (a handle tap, Escape): commit it
   * first, then walk `y` to its snap. A band pair commits the display at the
   * current height, where the field is still at the outgoing layout, so the
   * travel plays the cascade rather than the settle spring compressing it into
   * a couple of frames. Reduced motion swaps in one frame, as always.
   */
  const goTo = useCallback((next: ToolsDockMode) => {
    const target = clampDockMode(next, cap)
    if (target === modeRef.current)
      return
    const bandPair = isBandTransition(modeRef.current, target) && order.includes('expanded')
    const to = geomRef.current.offsets[order.indexOf(target)] ?? geomRef.current.offset
    // Claim the next settle before the commit re-renders: the layout effect
    // below would otherwise replace this tween with the settle spring.
    bandTweenRef.current = bandPair && !reduce
    commitDisplay(target)
    if (!bandPair)
      return
    if (reduce)
      y.set(to)
    else
      animate(y, to, { duration: DOCK_BAND_TAP_S, ease: EASE_OUT })
  }, [cap, commitDisplay, geomRef, modeRef, order, reduce, y])

  const intent = dockHandleIntent(mode, cap)
  const handleIcon = INTENT_ICON[intent]
  const handleLabel = t(INTENT_LABEL[intent])

  return (
    <div
      className={`tools-dock fixed inset-0 z-(--z-dock) flex items-end pointer-events-none transition-opacity duration-(--dur-fast) ease-(--ease-out) ${
        hidden ? 'opacity-0' : 'opacity-100'
      }`}
      inert={hidden || undefined}
    >
      {/*
        Full-width sheet: tools snap inside a max-height clip above a pinned
        Footer (byline is part of the dock). Clip is pointer-events-none so
        the transparent gap above a short display does not block the stage.
      */}
      <div className="flex w-full flex-col text-txt">
        <div className="relative w-full overflow-hidden pointer-events-none" style={{ height: toolsMaxH }}>
          <section
            aria-label={t('Tools')}
            data-dock-mode={mode}
            data-dock-bg={dockBg}
            /* The band is in flight: the lists freeze (scrollLockCls) and the
               harness can see the transit without reading a transform. */
            data-dock-band={band.active || undefined}
            ref={popupRef}
            style={{ ...surface.style, height: toolsMaxH, y } as CSSProperties & { y: typeof y }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClickCapture={(e) => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                e.stopPropagation()
                e.preventDefault()
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape')
                goTo(dockTransition(mode, { type: 'dismiss' }, cap))
            }}
            className={`dock-surface group/dock relative box-border flex w-full flex-col ${surface.className} pointer-events-auto overflow-hidden rounded-none border-0 border-t border-solid outline-0 transition-[background-color,border-color,box-shadow,backdrop-filter,--glass-fade] duration-(--dur-drawer) ease-(--ease-drawer) data-swiping:will-change-transform`}
          >
            <button
              type="button"
              className={`${handleCls} pointer-events-auto`}
              title={handleLabel}
              aria-label={handleLabel}
              aria-expanded={mode !== 'icons'}
              onClick={() => goTo(dockTransition(mode, { type: 'tap' }, cap))}
            >
              <MorphIcon icon={handleIcon} size={16} strokeWidth={1.75} />
            </button>
            {/* Relative host for the swap's exit ghost (see playSwap). */}
            <div className="relative flex min-h-0 flex-1 flex-col outline-0">
              <div
                ref={scrollRef}
                /* Mid-band the list cannot scroll, so a fade over it would
                   advertise an affordance the lock has taken away. */
                style={band.active ? undefined : (wrap ? scrollFadeStyle : scrollFadeStyleX)}
                data-dock-fade=""
                className={`min-h-0 flex-1 ${wrap ? scrollExpCls : scrollRowCls} ${scrollLockCls}`}
              >
                <div
                  ref={attachInner}
                  data-dock-context={contextKey}
                  className={wrap ? wrapCls : rowCls}
                />
              </div>
            </div>
          </section>
        </div>
        <Footer className="pointer-events-auto" />
      </div>
    </div>
  )
}
