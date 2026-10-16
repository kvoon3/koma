import { ChevronDown, ChevronUp, Rows2, Rows3 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useT } from '../lib/i18n'
import { scrollFadeStyle, scrollFadeStyleX, useScrollFade } from '../lib/useScrollFade'
import { useStore } from '../store'
import { dockBtnStateCls } from './ui/menu'

export const toolsBtnCls = 'flex w-[80px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 whitespace-nowrap rounded-none border-0 bg-transparent px-2 py-3 text-float-icon transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt'
export const toolsLabelCls = 'text-[11.5px] font-semibold text-txt'

/* Overlay above the footer: never takes layout space. Only the handle opens
   it; collapsed it rests behind the footer with the handle showing. */
const toolsPanelCls = 'relative mb-2 w-fit max-w-[min(920px,100vw)] rounded-none border border-line bg-drawer-bg shadow-pop transition-transform duration-(--dur-morph) ease-(--ease-drawer)'
const toolsHandleCls = 'absolute -top-[20px] left-1/2 grid h-5 w-16 -translate-x-1/2 cursor-pointer place-items-center rounded-t-[6px] border border-b-0 border-float-line bg-float-bg p-0 text-float-icon backdrop-blur-[7px] transition-[opacity,scale] duration-(--dur-surface) active:scale-[0.97] hover:text-txt'
const toolsScrollCompactCls = 'overflow-x-auto overscroll-x-contain touch-pan-x [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
const toolsScrollExpandedCls = 'overflow-x-hidden overflow-y-auto overscroll-contain max-h-[min(40dvh,320px)] [&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb'
const toolsRowCompactCls = 'flex w-max items-stretch'
const toolsRowExpandedCls = 'flex w-full max-w-[min(920px,calc(100vw-24px))] flex-wrap items-stretch justify-center'

/**
 * Bottom tools dock shared by the collage stage and the 3×3 grid route.
 * Compact = single horizontal scrolling row; expanded = tools wrap to
 * multiple lines. The expand control is always the last entry.
 */
export function ToolsDock({ hidden, open, contextKey, children, handleLabel, onToggle }: {
  hidden: boolean
  open: boolean
  contextKey: string
  children: React.ReactNode
  handleLabel: string
  onToggle: () => void
}) {
  const t = useT()
  const expanded = useStore(s => s.toolsExpanded)
  const setToolsExpanded = useStore(s => s.setToolsExpanded)
  const scrollRef = useScrollFade<HTMLDivElement>(expanded ? 'y' : 'x')

  return (
    <div
      className={`tools-dock pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center transition-opacity duration-(--dur-fast) ease-(--ease-out) ${
        hidden ? 'opacity-0' : 'opacity-100'
      }`}
      inert={hidden}
    >
      <div className={`${toolsPanelCls} ${
        hidden ? 'pointer-events-none' : 'pointer-events-auto'
      } ${
        open ? 'translate-y-0' : 'translate-y-[calc(100%+10px)]'
      }`}
      >
        <button
          type="button"
          className={toolsHandleCls}
          title={handleLabel}
          aria-expanded={open}
          aria-label={handleLabel}
          onClick={onToggle}
        >
          <MorphIcon icon={open ? ChevronDown : ChevronUp} size={14} strokeWidth={1.75} />
        </button>
        <div
          ref={scrollRef}
          style={expanded ? scrollFadeStyle : scrollFadeStyleX}
          data-dock-fade=""
          className={expanded ? toolsScrollExpandedCls : toolsScrollCompactCls}
          inert={!open}
        >
          <div
            key={contextKey}
            className={`${expanded ? toolsRowExpandedCls : toolsRowCompactCls} transition-[opacity,translate] duration-(--dur-surface) ease-(--ease-out) starting:translate-y-1 starting:opacity-0`}
          >
            {children}
            <button
              type="button"
              className={`${toolsBtnCls} ${dockBtnStateCls}${expanded ? ' bg-chip-on text-chip-on-txt shadow-[inset_0_-2px_0_var(--accent)] hover:bg-chip-on hover:text-chip-on-txt' : ''}`}
              title={t(expanded ? 'Compact tools' : 'Expand tools')}
              aria-label={t(expanded ? 'Compact tools' : 'Expand tools')}
              aria-pressed={expanded}
              data-dock-tool={t(expanded ? 'Compact' : 'Expand')}
              onClick={() => setToolsExpanded(!expanded)}
            >
              <MorphIcon icon={expanded ? Rows2 : Rows3} size={22} strokeWidth={1.5} />
              <span className={toolsLabelCls}>{t(expanded ? 'Compact' : 'Expand')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
