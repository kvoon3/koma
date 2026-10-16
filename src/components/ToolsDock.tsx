import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import type { ToolsDockMode } from '../store'
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { scrollFadeStyle, scrollFadeStyleX, useScrollFade } from '../lib/useScrollFade'
import { useStore } from '../store'

export const toolsBtnCls = 'flex w-[80px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 whitespace-nowrap rounded-none border-0 bg-transparent px-2 py-3 text-float-icon transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt'
export const toolsLabelCls = 'text-[11.5px] font-semibold text-txt'

const MAX_EXP_VH = 0.4
const TAP_PX = 10
const VELOCITY_FLIP = 0.55 // px/ms; fling past midpoint toward next snap

const panelCls = 'relative mb-2 w-fit max-w-[min(920px,100vw)] rounded-none border border-line bg-drawer-bg shadow-pop'
const handleCls = 'absolute -top-[20px] left-1/2 flex h-5 w-16 -translate-x-1/2 cursor-grab touch-none select-none flex-col items-center justify-center gap-0.5 rounded-t-[6px] border border-b-0 border-float-line bg-float-bg p-0 text-float-icon backdrop-blur-[7px] transition-[opacity,scale,color] duration-(--dur-surface) active:cursor-grabbing active:scale-[0.97] hover:text-txt'
const handlePillCls = 'h-1 w-8 rounded-full bg-float-icon/45'
const scrollRowCls = 'overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
const scrollExpCls = 'overflow-x-hidden overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
const rowCls = 'flex w-max items-stretch'
const wrapCls = 'flex w-full max-w-[min(920px,calc(100vw-24px))] flex-wrap items-stretch justify-center'

const ORDER: ToolsDockMode[] = ['collapsed', 'row', 'expanded']

function nextMode(mode: ToolsDockMode): ToolsDockMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!
}

function heightFor(mode: ToolsDockMode, rowH: number, expH: number): number {
  if (mode === 'collapsed')
    return 0
  if (mode === 'row')
    return rowH
  return expH
}

function nearestMode(h: number, rowH: number, expH: number, v: number): ToolsDockMode {
  const targets: { mode: ToolsDockMode, h: number }[] = [
    { mode: 'collapsed', h: 0 },
    { mode: 'row', h: rowH },
    { mode: 'expanded', h: expH },
  ]
  // Fling: strong velocity picks the next snap in that direction from the
  // closest stop, so a quick flick skips the midpoint slog.
  if (Math.abs(v) >= VELOCITY_FLIP) {
    const sorted = [...targets].sort((a, b) => Math.abs(a.h - h) - Math.abs(b.h - h))
    const closest = sorted[0]!
    const idx = ORDER.indexOf(closest.mode)
    if (v > 0) {
      // Finger down → shorter sheet
      return ORDER[Math.max(0, idx - 1)]!
    }
    return ORDER[Math.min(ORDER.length - 1, idx + 1)]!
  }
  let best = targets[0]!
  let bestDist = Math.abs(h - best.h)
  for (let i = 1; i < targets.length; i++) {
    const d = Math.abs(h - targets[i]!.h)
    if (d < bestDist) {
      best = targets[i]!
      bestDist = d
    }
  }
  return best.mode
}

function modeLabel(mode: ToolsDockMode, t: (k: string) => string): string {
  if (mode === 'collapsed')
    return t('Show tools')
  if (mode === 'row')
    return t('Expand tools')
  return t('Hide tools')
}

/**
 * Bottom tools sheet with three snaps: collapsed / single-row / multi-row.
 * Drag the handle vertically (height follows the finger; release snaps by
 * position + velocity). A tap cycles collapsed → row → expanded → collapsed.
 */
export function ToolsDock({ hidden, contextKey, children }: {
  hidden: boolean
  contextKey: string
  children: ReactNode
}) {
  const t = useT()
  const mode = useStore(s => s.toolsDockMode)
  const setMode = useStore(s => s.setToolsDockMode)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [rowH, setRowH] = useState(72)
  const [expH, setExpH] = useState(72)
  // Live sheet height while dragging; null = driven by mode.
  const [dragH, setDragH] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startY: 0,
    startH: 0,
    lastY: 0,
    lastT: 0,
    velocity: 0,
    moved: false,
  })

  const wrap = mode === 'expanded' || (dragH != null && dragH > rowH + 8)
  const scrollRef = useScrollFade<HTMLDivElement>(wrap ? 'y' : 'x')

  const setBodyRef = useCallback((el: HTMLDivElement | null) => {
    bodyRef.current = el
    scrollRef(el)
  }, [scrollRef])

  const measure = useCallback(() => {
    const el = innerRef.current
    if (!el)
      return
    const maxExp = Math.round(window.innerHeight * MAX_EXP_VH)
    // Row: nowrap intrinsic height.
    const prevWrap = el.style.flexWrap
    const prevW = el.style.width
    const prevMax = el.style.maxWidth
    el.style.flexWrap = 'nowrap'
    el.style.width = 'max-content'
    el.style.maxWidth = 'none'
    const row = Math.ceil(el.getBoundingClientRect().height) || 72
    // Expanded: wrap to panel width.
    const panelW = el.parentElement?.clientWidth || Math.min(920, window.innerWidth - 24)
    el.style.flexWrap = 'wrap'
    el.style.width = '100%'
    el.style.maxWidth = `${panelW}px`
    const exp = Math.min(Math.ceil(el.scrollHeight) || row, maxExp)
    el.style.flexWrap = prevWrap
    el.style.width = prevW
    el.style.maxWidth = prevMax
    setRowH(row)
    setExpH(Math.max(row, exp))
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, children, contextKey, mode])

  useEffect(() => {
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure])

  const targetH = heightFor(mode, rowH, expH)
  const h = dragH ?? targetH

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0)
      return
    e.preventDefault()
    const startH = dragH ?? heightFor(mode, rowH, expH)
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startY: e.clientY,
      startH,
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
      moved: false,
    }
    setDragging(true)
    setDragH(startH)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d.active || e.pointerId !== d.pointerId)
      return
    const now = performance.now()
    const dy = e.clientY - d.startY
    if (Math.abs(dy) > TAP_PX)
      d.moved = true
    // Finger down → shorter sheet.
    const next = Math.min(expH, Math.max(0, d.startH - dy))
    const dt = Math.max(1, now - d.lastT)
    d.velocity = (e.clientY - d.lastY) / dt
    d.lastY = e.clientY
    d.lastT = now
    setDragH(next)
  }

  const finishDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d.active || e.pointerId !== d.pointerId)
      return
    d.active = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    catch {
      // already released
    }
    // Derive height from the pointer, not React state (up can fire before the
    // last move state commit).
    const finalH = Math.min(expH, Math.max(0, d.startH - (e.clientY - d.startY)))
    if (!d.moved) {
      setDragH(null)
      setDragging(false)
      setMode(nextMode(mode))
      return
    }
    // velocity: positive = finger down = collapsing
    const snapped = nearestMode(finalH, rowH, expH, d.velocity)
    setDragging(false)
    setDragH(null)
    setMode(snapped)
  }

  const handleIcon = mode === 'collapsed'
    ? ChevronUp
    : mode === 'expanded'
      ? ChevronDown
      : ChevronsUpDown

  return (
    <div
      className={`tools-dock pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center transition-opacity duration-(--dur-fast) ease-(--ease-out) ${
        hidden ? 'opacity-0' : 'opacity-100'
      }`}
      inert={hidden}
    >
      <div
        className={`${panelCls} ${hidden ? 'pointer-events-none' : 'pointer-events-auto'}`}
        data-dock-mode={mode}
        data-dock-dragging={dragging ? '' : undefined}
      >
        <button
          type="button"
          className={handleCls}
          title={modeLabel(mode, t)}
          aria-label={modeLabel(mode, t)}
          aria-expanded={mode !== 'collapsed'}
          aria-valuetext={mode}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <span className={handlePillCls} aria-hidden />
          <MorphIcon icon={handleIcon} size={12} strokeWidth={1.75} />
        </button>
        <div
          ref={setBodyRef}
          style={{
            height: h,
            transition: dragging ? 'none' : 'height var(--dur-morph) var(--ease-drawer)',
            ...(wrap ? scrollFadeStyle : scrollFadeStyleX),
          }}
          data-dock-fade=""
          className={`will-change-[height] ${wrap ? scrollExpCls : scrollRowCls}`}
          inert={mode === 'collapsed' && !dragging}
        >
          <div
            key={contextKey}
            ref={innerRef}
            className={`${wrap ? wrapCls : rowCls} transition-[opacity,translate] duration-(--dur-surface) ease-(--ease-out) starting:translate-y-1 starting:opacity-0`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
