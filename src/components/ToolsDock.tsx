import type { ReactNode } from 'react'
import type { ToolsDockMode } from '../store'
import { Drawer } from '@base-ui/react/drawer'
import { ChevronDown, ChevronUp } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { scrollFadeStyle, scrollFadeStyleX, useScrollFade } from '../lib/useScrollFade'
import { useStore } from '../store'
import { Footer } from './Footer'

export const toolsBtnCls = 'flex w-[80px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 whitespace-nowrap rounded-none border-0 bg-transparent px-2 py-3 text-float-icon transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt'
export const toolsLabelCls = 'text-[11.5px] font-semibold text-txt'

/** Handle chrome height = collapsed snap. Keep in sync with `handleCls` h-[]. */
const HANDLE_H = 28
const MAX_EXP_VH = 0.4
const FALLBACK_ROW = 72

const ORDER: ToolsDockMode[] = ['collapsed', 'row', 'expanded']

const handleCls = 'relative z-1 flex h-[28px] w-full shrink-0 cursor-grab touch-none select-none items-center justify-center border-0 bg-transparent p-0 text-float-icon transition-[color,scale] duration-(--dur-surface) active:cursor-grabbing active:scale-[0.97] hover:text-txt'
const scrollRowCls = 'overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
const scrollExpCls = 'overflow-x-hidden overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
const rowCls = 'flex w-max items-stretch'
const wrapCls = 'flex w-full flex-wrap items-stretch justify-center'

function nextMode(mode: ToolsDockMode): ToolsDockMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!
}

function modeLabel(mode: ToolsDockMode, t: (k: string) => string): string {
  if (mode === 'collapsed')
    return t('Show tools')
  if (mode === 'row')
    return t('Expand tools')
  return t('Hide tools')
}

function modeFromSnap(snap: number | string, snaps: number[]): ToolsDockMode {
  const idx = snaps.findIndex(p => Object.is(p, snap))
  if (idx >= 0)
    return ORDER[idx]!
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
    return ORDER[best]!
  }
  return 'row'
}

/**
 * Full-width Base UI Drawer tools sheet: handle + tools snap above an
 * always-on Footer strip (byline lives in the sheet, not under it).
 * Collapsed / row / expanded via snap points; chevron morphs up↔down.
 */
export function ToolsDock({ hidden, contextKey, children }: {
  hidden: boolean
  contextKey: string
  children: ReactNode
}) {
  const t = useT()
  const mode = useStore(s => s.toolsDockMode)
  const setMode = useStore(s => s.setToolsDockMode)

  const innerRef = useRef<HTMLDivElement | null>(null)
  const [rowH, setRowH] = useState(FALLBACK_ROW)
  const [expH, setExpH] = useState(FALLBACK_ROW)

  const wrap = mode === 'expanded'
  const scrollRef = useScrollFade<HTMLDivElement>(wrap ? 'y' : 'x')

  const snapPoints = useMemo(
    () => [HANDLE_H, HANDLE_H + rowH, HANDLE_H + expH] as number[],
    [rowH, expH],
  )
  const snapPoint = snapPoints[ORDER.indexOf(mode)] ?? snapPoints[1]!
  const toolsMaxH = snapPoints[2]!

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
    const row = Math.ceil(el.getBoundingClientRect().height) || FALLBACK_ROW
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
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, children, contextKey, mode])

  useEffect(() => {
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure])

  // Expanded: point down (can collapse). Otherwise point up (can open more).
  const handleIcon = mode === 'expanded' ? ChevronDown : ChevronUp

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
          setMode('collapsed')
        }
      }}
      onSnapPointChange={(next, details) => {
        if (next == null) {
          details.cancel()
          setMode('collapsed')
          return
        }
        setMode(modeFromSnap(next, snapPoints))
      }}
    >
      <Drawer.Portal keepMounted>
        <Drawer.Viewport
          className={`tools-dock fixed inset-0 z-30 flex items-end pointer-events-none transition-opacity duration-(--dur-fast) ease-(--ease-out) ${
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
                style={{ height: toolsMaxH }}
                className="group/dock pointer-events-auto relative box-border flex w-full flex-col overflow-hidden rounded-none border-t border-line bg-drawer-bg shadow-pop outline-0 translate-y-[calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px))] transition-transform duration-(--dur-drawer) ease-(--ease-drawer) data-swiping:will-change-transform data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:translate-y-full data-ending-style:translate-y-full"
              >
                <button
                  type="button"
                  className={handleCls}
                  title={modeLabel(mode, t)}
                  aria-label={modeLabel(mode, t)}
                  aria-expanded={mode !== 'collapsed'}
                  aria-valuetext={mode}
                  onClick={() => setMode(nextMode(mode))}
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
                      key={contextKey}
                      ref={innerRef}
                      className={`${wrap ? wrapCls : rowCls} transition-[opacity,translate] duration-(--dur-surface) ease-(--ease-out) starting:translate-y-1 starting:opacity-0`}
                    >
                      {children}
                    </div>
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
