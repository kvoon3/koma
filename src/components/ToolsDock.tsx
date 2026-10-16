import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react'
import type { ToolsDockMode } from '../store'
import { Drawer } from '@base-ui/react/drawer'
import { ChevronDown, ChevronUp, Minus } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../lib/i18n'
import { clampDockMode, dockHandleIntent, dockModes, dockTransition } from '../lib/toolsDockMode'
import { scrollFadeStyle, scrollFadeStyleX, useScrollFade } from '../lib/useScrollFade'
import { useStore } from '../store'
import { Footer } from './Footer'
import { dockBtnSurfaceCls } from './ui/menu'

export const toolsBtnCls = `${dockBtnSurfaceCls} flex w-[80px] shrink-0 flex-col items-center justify-center gap-1.5 whitespace-nowrap px-2 py-3`
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
const INTENT_ICON = { show: Minus, expand: ChevronUp, hide: ChevronDown } as const

function modeFromSnap(snap: number | string, snaps: number[], order: readonly ToolsDockMode[]): ToolsDockMode {
  const idx = snaps.findIndex(p => Object.is(p, snap))
  if (idx >= 0)
    return order[idx]!
  if (typeof snap === 'number') {
    let best = 0
    let bestDist = Math.abs(snaps[0]! - snap)
    for (let i = 1; i < snaps.length; i++) {
      const d = Math.abs(snaps[i]! - snap)
      if (d < bestDist) {
        best = i
        bestDist = d
      }
    }
    return order[best]!
  }
  return 'row'
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

  // Content-driven snap geometry changes (route switch, wrap change) must not
  // animate: the sheet would slide even though the user's mode is unchanged.
  // Only mode changes animate the transform.
  const [instant, setInstant] = useState(false)
  const lastGeomRef = useRef({ toolsMaxH, mode })
  useLayoutEffect(() => {
    const prev = lastGeomRef.current
    lastGeomRef.current = { toolsMaxH, mode }
    if (prev.toolsMaxH === toolsMaxH || prev.mode !== mode)
      return
    setInstant(true)
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setInstant(false))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [toolsMaxH, mode])

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
    const panelW = el.parentElement?.clientWidth || window.innerWidth
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
    const mo = new MutationObserver(() => measure())
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    const ro = new ResizeObserver(() => measure())
    if (el.parentElement)
      ro.observe(el.parentElement)
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => {
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [measure])

  // Icon + label describe the next tap (row with no room to expand → hide).
  const intent = dockHandleIntent(mode, cap)
  const handleIcon = INTENT_ICON[intent]
  const handleLabel = t(INTENT_LABEL[intent])

  return (
    <Drawer.Root
      open
      modal={false}
      disablePointerDismissal
      swipeDirection="down"
      snapPoints={snapPoints}
      snapPoint={snapPoint}
      defaultSnapPoint={snapPoints[1]}
      onOpenChange={(next, details) => {
        if (!next) {
          details.cancel()
          setMode(dockTransition(mode, { type: 'dismiss' }, cap))
        }
      }}
      onSnapPointChange={(next, details) => {
        if (next == null) {
          details.cancel()
          setMode(dockTransition(mode, { type: 'dismiss' }, cap))
          return
        }
        setMode(dockTransition(mode, { type: 'snap', mode: modeFromSnap(next, snapPoints, order) }, cap))
      }}
    >
      <Drawer.Portal keepMounted>
        <Drawer.Viewport
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
              <Drawer.Popup
                initialFocus={false}
                finalFocus={false}
                data-dock-mode={mode}
                data-instant={instant || undefined}
                style={{ 'height': toolsMaxH, '--dock-offset': `${toolsMaxH - snapPoint}px` } as CSSProperties}
                className="group/dock pointer-events-auto relative box-border flex w-full flex-col overflow-hidden rounded-none border-t border-line bg-drawer-bg shadow-pop outline-0 translate-y-[calc(var(--dock-offset)+var(--drawer-swipe-movement-y,0px))] transition-transform duration-(--dur-drawer) ease-(--ease-drawer) data-swiping:will-change-transform data-swiping:duration-0 data-instant:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:translate-y-full data-ending-style:translate-y-full"
              >
                <button
                  type="button"
                  className={handleCls}
                  title={handleLabel}
                  aria-label={handleLabel}
                  aria-expanded={mode !== 'collapsed'}
                  aria-valuetext={mode}
                  onClick={() => setMode(dockTransition(mode, { type: 'tap' }, cap))}
                >
                  <MorphIcon icon={handleIcon} size={16} strokeWidth={1.75} />
                </button>
                <Drawer.Content className="flex min-h-0 flex-1 flex-col outline-0">
                  <Drawer.Title className="sr-only">{t('Tools')}</Drawer.Title>
                  <div
                    ref={scrollRef}
                    style={wrap ? scrollFadeStyle : scrollFadeStyleX}
                    data-dock-fade=""
                    data-base-ui-swipe-ignore={wrap ? undefined : 'x'}
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
                </Drawer.Content>
              </Drawer.Popup>
            </div>
            <Footer className="pointer-events-auto" />
          </div>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
