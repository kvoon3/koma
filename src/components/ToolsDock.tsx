import type { CSSProperties, Dispatch, ReactNode, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { ChevronDown, ChevronUp, Ruler } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { animate, useMotionValue, useReducedMotion } from 'motion/react'
import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { dockDragFade, dockSurface } from '../lib/dockBackground'
import { dampOffset, pickSnap } from '../lib/dockPhysics'
import { useT } from '../lib/i18n'
import { liquidGlassRef } from '../lib/liquidGlass'
import { clampDockMode, dockHandleIntent, dockModes, dockTransition } from '../lib/toolsDockMode'
import { scrollFadeStyle, scrollFadeStyleX, useScrollFade } from '../lib/useScrollFade'
import { useStore } from '../store'
import { Footer } from './Footer'
import { dockBtnSurfaceCls } from './ui/menu'

export const toolsBtnCls = `${dockBtnSurfaceCls} disabled:order-1 data-disabled:order-1 flex w-[80px] shrink-0 flex-col items-center justify-center gap-1.5 whitespace-nowrap px-2 py-3`
export const toolsLabelCls = 'text-[11.5px] font-semibold text-txt'

/** Handle chrome height = collapsed snap. Keep in sync with `handleCls` h-[]. */
const HANDLE_H = 28
const MAX_EXP_VH = 0.4
const FALLBACK_ROW = 72

const handleCls = 'relative z-1 flex h-[28px] w-full shrink-0 cursor-grab touch-none select-none items-center justify-center border-0 bg-transparent p-0 text-float-icon transition-[color,scale] duration-(--dur-surface) active:cursor-grabbing active:scale-[0.97] hover:text-txt'
const scrollRowCls = 'overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
const scrollExpCls = 'overflow-x-hidden overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
const rowCls = 'flex w-max items-stretch'
const wrapCls = 'flex w-full flex-wrap items-stretch justify-center'

const INTENT_LABEL = { show: 'Show tools', expand: 'Expand tools', hide: 'Hide tools' } as const
const INTENT_ICON = { expand: ChevronUp, hide: ChevronDown } as const

/** Settle spring (Vaul-like feel: quick, barely any overshoot). */
const SPRING = { type: 'spring', stiffness: 420, damping: 42, mass: 1 } as const
/** px before a press becomes a drag (taps stay clicks). */
const DRAG_SLOP = 6

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
 */
export function ToolsDock({ hidden, contextKey, children }: {
  hidden: boolean
  contextKey: string
  children: ReactNode
}) {
  const ctx = use(ToolsDockContext)
  const setSlot = ctx?.setSlot
  useLayoutEffect(() => {
    setSlot?.({ hidden, contextKey })
  }, [setSlot, hidden, contextKey])
  useLayoutEffect(() => () => setSlot?.(null), [setSlot])
  if (!ctx?.target)
    return null
  return createPortal(children, ctx.target)
}

/**
 * Full-width Base UI Drawer tools sheet, mounted once in the root layout:
 * handle + tools snap above an always-on Footer strip.
 * Collapsed / row / expanded via snap points (expanded only when the tools
 * wrap). Handle icon morphs line (collapsed) → chevron up (row) → down.
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
  const [rowH, setRowH] = useState(FALLBACK_ROW)
  const [expH, setExpH] = useState(FALLBACK_ROW)
  const [fitsOneRow, setFitsOneRow] = useState(true)
  const cap = useMemo(() => ({ fitsOneRow }), [fitsOneRow])
  const mode = clampDockMode(storedMode, cap)
  const order = dockModes(cap)

  const wrap = mode === 'expanded'
  const scrollRef = useScrollFade<HTMLDivElement>(wrap ? 'y' : 'x')

  const snapPoints = useMemo(
    () => (fitsOneRow ? [HANDLE_H, HANDLE_H + rowH] : [HANDLE_H, HANDLE_H + rowH, HANDLE_H + expH]) as number[],
    [rowH, expH, fitsOneRow],
  )
  const snapPoint = snapPoints[order.indexOf(mode)] ?? snapPoints[1]!
  const toolsMaxH = snapPoints.at(-1)!

  const reduce = useReducedMotion()
  const reduceRef = useRef(reduce)
  useLayoutEffect(() => {
    reduceRef.current = reduce
  })
  const measure = useCallback(() => {
    const el = innerRef.current
    if (!el)
      return
    const maxExp = Math.round(window.innerHeight * MAX_EXP_VH)
    const prevWrap = el.style.flexWrap
    const prevW = el.style.width
    const prevMax = el.style.maxWidth
    const prevVis = el.style.visibility
    el.style.visibility = 'hidden'
    el.style.flexWrap = 'nowrap'
    el.style.width = 'max-content'
    el.style.maxWidth = 'none'
    const rect = el.getBoundingClientRect()
    const row = Math.ceil(rect.height) || FALLBACK_ROW
    const rowW = Math.ceil(rect.width)
    // Full sheet width, not the popup's (it shrinks to the handle when collapsed).
    const panelW = el.closest<HTMLElement>('.tools-dock')?.clientWidth || window.innerWidth
    el.style.flexWrap = 'wrap'
    el.style.width = '100%'
    el.style.maxWidth = `${panelW}px`
    const exp = Math.min(Math.ceil(el.scrollHeight) || row, maxExp)
    el.style.flexWrap = prevWrap
    el.style.width = prevW
    el.style.maxWidth = prevMax
    el.style.visibility = prevVis
    setRowH(row)
    setExpH(Math.max(row, exp))
    // Empty slot (between routes) keeps the last capacity: no snap churn.
    if (el.childElementCount > 0)
      setFitsOneRow(rowW <= panelW)
  }, [])

  const attachInner = useCallback((el: HTMLDivElement | null) => {
    innerRef.current = el
    setInner(el)
  }, [setInner])

  useLayoutEffect(() => {
    measure()
  }, [measure, contextKey, mode])

  // Portaled route content changes without re-rendering this sheet:
  // observe DOM + size instead of depending on `children`.
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
    }
  }, [measure])

  // Icon + label describe the next tap (row with no room to expand → hide).
  const surface = dockSurface(dockBg, dockOpacity, mode)

  // Sheet position is one motion value: px below fully open (0 = largest
  // snap). Drags write it directly (rubber-banded past the end snaps);
  // releases and mode changes spring it to the snap with the release
  // velocity. No React re-render per frame.
  const offsets = snapPoints.map(sp => toolsMaxH - sp)
  const offset = toolsMaxH - snapPoint
  const y = useMotionValue(offset)
  const pendingVelRef = useRef(0)
  const dragRef = useRef<null | { id: number, x: number, y: number, start: number, active: boolean, inScroll: boolean }>(null)
  const suppressClickRef = useRef(false)
  const geomRef = useRef({ toolsMaxH, rowH, offsets, offset })
  useLayoutEffect(() => {
    geomRef.current = { toolsMaxH, rowH, offsets, offset }
  })

  // Settle on mode / geometry change. Content-driven geometry (route switch,
  // wrap change) jumps: the user's mode didn't change, so nothing slides.
  const lastGeomRef = useRef({ toolsMaxH, mode })
  useLayoutEffect(() => {
    const prev = lastGeomRef.current
    lastGeomRef.current = { toolsMaxH, mode }
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

  const liquidOn = dockBg === 'liquid' && mode !== 'collapsed'
  const popupRef = useCallback((el: HTMLDivElement | null) => {
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
      el.style.transform = `translateY(${v}px)`
      sync(v)
    }
    move(y.get())
    const off = y.on('change', move)
    const glass = liquidOn ? liquidGlassRef(el) : undefined
    return () => {
      off()
      glass?.()
    }
  }, [liquidOn, y])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || hidden)
      return
    const inScroll = !!(e.target as HTMLElement).closest('[data-dock-fade]')
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: y.get(), active: false, inScroll }
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
      // Horizontal gestures in the tools row scroll it; an expanded list
      // that is scrolled keeps its own vertical scroll.
      const scroller = (e.target as HTMLElement).closest<HTMLElement>('[data-dock-fade]')
      if (d.inScroll && (Math.abs(dx) > Math.abs(dy) || (wrap && scroller && (scroller.scrollTop > 0 || dy < 0) && scroller.scrollHeight > scroller.clientHeight))) {
        dragRef.current = null
        return
      }
      d.active = true
      d.start = y.get()
      y.stop()
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.setAttribute('data-swiping', '')
    }
    const { offsets: offs } = geomRef.current
    y.set(dampOffset(d.start + dy, Math.min(...offs), Math.max(...offs)))
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId)
      return
    dragRef.current = null
    if (!d.active)
      return
    suppressClickRef.current = true
    e.currentTarget.removeAttribute('data-swiping')
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    const { offsets: offs, offset: cur } = geomRef.current
    const velocity = e.type === 'pointercancel' ? 0 : y.getVelocity()
    const idx = pickSnap(offs, y.get(), velocity, Math.max(0, order.indexOf(mode)))
    const next = dockTransition(mode, { type: 'snap', mode: order[idx]! }, cap)
    if (next === mode) {
      animate(y, cur, reduce ? { duration: 0 } : { ...SPRING, velocity })
    }
    else {
      pendingVelRef.current = velocity
      setMode(next)
    }
  }

  const intent = dockHandleIntent(mode, cap)
  const handleIcon = intent === 'show' ? Ruler : INTENT_ICON[intent]
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
        the transparent collapsed gap does not block the stage.
      */}
      <div className="flex w-full flex-col text-txt">
        <div className="relative w-full overflow-hidden pointer-events-none" style={{ height: toolsMaxH }}>
          <section
            aria-label={t('Tools')}
            data-dock-mode={mode}
            data-dock-bg={dockBg}
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
              if (e.key === 'Escape' && mode !== 'collapsed')
                setMode(dockTransition(mode, { type: 'dismiss' }, cap))
            }}
            className={`dock-surface group/dock relative box-border flex w-full flex-col ${surface.className} ${mode === 'collapsed' ? 'pointer-events-none data-swiping:pointer-events-auto' : 'pointer-events-auto'} overflow-hidden rounded-none border-0 border-t border-solid outline-0 transition-[background-color,border-color,box-shadow,backdrop-filter,--glass-fade] duration-(--dur-drawer) ease-(--ease-drawer) data-swiping:will-change-transform`}
          >
            <button
              type="button"
              className={`${handleCls} ${mode === 'collapsed' ? 'pointer-events-auto mx-auto w-11! rounded-full' : ''}`}
              title={handleLabel}
              aria-label={handleLabel}
              aria-expanded={mode !== 'collapsed'}
              aria-valuetext={mode}
              onClick={() => setMode(dockTransition(mode, { type: 'tap' }, cap))}
            >
              <MorphIcon icon={handleIcon} size={16} strokeWidth={1.75} />
            </button>
            <div className="flex min-h-0 flex-1 flex-col outline-0">
              <div
                ref={scrollRef}
                style={wrap ? scrollFadeStyle : scrollFadeStyleX}
                data-dock-fade=""
                className={`min-h-0 flex-1 ${wrap ? scrollExpCls : scrollRowCls} ${
                  mode === 'collapsed'
                    ? 'invisible pointer-events-none group-data-swiping/dock:visible group-data-swiping/dock:pointer-events-auto'
                    : ''
                }`}
                inert={mode === 'collapsed' || undefined}
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
