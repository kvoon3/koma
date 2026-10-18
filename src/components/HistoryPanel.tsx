import type { RefObject } from 'react'
import type { History } from '../lib/history'
import { Popover } from '@base-ui/react/popover'
import { GitBranch } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useRef, useState } from 'react'
import { historyLabel, historyPath, stepAge } from '../lib/history'
import { useT } from '../lib/i18n'
import { useStore } from '../store'

/**
 * The step tree as a list, in the popover shape the top bar's other panels use
 * (see SettingsPanel): one row per step from the root down to the cursor, and
 * at any step that has more than one child a branch badge that opens the steps
 * beside it.
 *
 * A row is a jump: the store restores that step's board in one move, which
 * records nothing, so browsing history never grows it. The list reads
 * root-first (chronology downwards) and the step the board is at is washed in
 * the active-row fill with an accent bar down its edge, the way the dock marks
 * the tool it is showing: the eye lands on it before it reads a word, at phone
 * and desktop size alike.
 */

/** The header clock: a step recorded seconds ago should say so without a reload. */
function useClock(open: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open)
      return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])
  return now
}

/** How long ago a step was recorded, in the reader's language. */
function agoLabel(t: ReturnType<typeof useT>, at: number, now: number): string {
  const age = stepAge(at, now)
  if (age === 'now')
    return t('now')
  if (age.unit === 's')
    return t('{n}s ago', { n: age.n })
  if (age.unit === 'm')
    return t('{n}m ago', { n: age.n })
  return t('{n}h ago', { n: age.n })
}

const popup = 'flex max-h-[min(70dvh,520px)] w-[min(320px,calc(100vw-20px))] max-sm:w-[calc(100vw-12px)] flex-col overflow-hidden rounded-none border border-line-strong bg-panel text-txt shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-(--dur-surface) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]'

const rowCls = 'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-none border-0 px-2 py-1.5 text-left text-xs text-txt outline-0 transition-[background-color,color] duration-(--dur-fast) focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent'

/**
 * The step the board is at: the chip-on wash plus a 2px accent bar on its
 * leading edge (the dock's "showing this one" idiom), and its clock stays
 * readable instead of faint. Its hover is swallowed, or a pointer would wash
 * the marker out at the moment it is most looked at.
 */
const currentRowCls = 'bg-chip-on font-medium text-chip-on-txt shadow-[inset_2px_0_0_var(--accent)] hover:bg-chip-on'

/** Any other step: quiet until hovered, pressed while clicked. */
const otherRowCls = 'bg-transparent hover:bg-chip-hover active:bg-chip-on active:text-chip-on-txt'

/** The branch badge: present, but quiet until the row is hovered or open. */
const badgeCls = 'flex flex-none cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent px-2 text-[10px] tabular-nums text-faint outline-0 transition-[background-color,color] duration-(--dur-fast) hover:bg-chip-hover hover:text-txt data-popup-open:bg-chip-on data-popup-open:text-chip-on-txt focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent'

/** A step's marker: filled for the cursor, hollow for a step you could return to. */
function Marker({ current }: { current: boolean }) {
  return <span aria-hidden className={`block size-1.5 flex-none ${current ? 'bg-accent' : 'border border-line-strong'}`} />
}

/**
 * The steps beside this one, under a visible tree gutter. Acting from a step
 * replaces the line below it (see lib/history), so a session's tree is normally
 * one chain and this list is empty; a forked tree that does arrive still shows
 * its variants here. A child already on the root-to-cursor path renders below
 * as its own row, so the expanded list holds only the OFF-path variants: no
 * duplicate labels, and the cursor's row never leaves the list.
 */
function variantSummary(history: History<unknown>, t: ReturnType<typeof useT>, id: string): string {
  const labels: string[] = []
  let node = history.nodes[id]
  while (node && labels.length < 2) {
    const kid = node.children.map(c => history.nodes[c]).find(Boolean)
    if (!kid)
      break
    labels.push(t(historyLabel(kid.label)))
    node = kid
  }
  return labels.join(' → ')
}

export function HistoryPanel({ open, onOpenChange, anchor }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the panel hangs under: the float cluster's History button. */
  anchor: RefObject<HTMLElement | null>
}) {
  const t = useT()
  const history = useStore(s => s.history)
  const jumpTo = useStore(s => s.jumpTo)
  const now = useClock(open)
  const ago = (at: number) => agoLabel(t, at, now)
  const [expanded, setExpanded] = useState<string | null>(null)
  const cursorRef = useRef<HTMLButtonElement | null>(null)

  const path = historyPath(history)
  const onPath = new Set(path)
  // Off-path variants, counted the way the badges count them: the direct
  // children of path steps that are NOT the path's continuation. The header
  // and the badges must agree on what "a variant" is.
  const offPath = path.reduce((n, id) => n + (history.nodes[id]?.children.filter(c => history.nodes[c] && !onPath.has(c)).length ?? 0), 0)

  const row = (id: string, variant: boolean) => {
    const node = history.nodes[id]
    if (!node)
      return null
    const current = id === history.cursor
    const children = node.children.filter(child => history.nodes[child])
    const label = t(historyLabel(node.label))
    const isExpanded = expanded === id
    const sub = variant ? variantSummary(history, t, id) : ''
    return (
      <div key={id}>
        <div className="flex items-stretch" data-history-row={id} data-history-variant={variant ? 'true' : undefined} data-history-current={current ? 'true' : undefined}>
          <button
            ref={current ? cursorRef : undefined}
            type="button"
            className={`${rowCls} ${current ? currentRowCls : otherRowCls}`}
            aria-current={current ? 'step' : undefined}
            aria-label={`${label} · ${ago(node.at)}`}
            title={variant && sub ? `${label} → ${sub}` : label}
            onClick={() => jumpTo(id)}
          >
            {variant
              ? <MorphIcon icon={GitBranch} size={10} strokeWidth={1.75} className="flex-none text-faint" aria-hidden />
              : <Marker current={current} />}
            <span className="flex min-w-0 flex-1 flex-col gap-0">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className={`flex-none text-[10px] tabular-nums ${current ? 'text-chip-on-txt' : 'text-faint'}`}>{ago(node.at)}</span>
              </span>
              {sub && (
                <span className="truncate text-[10px] text-faint">
                  →
                  {sub}
                </span>
              )}
            </span>
          </button>
          {children.length > 1 && (
            <button
              type="button"
              className={badgeCls}
              data-history-branch={id}
              aria-expanded={isExpanded}
              aria-label={t('{n} variants', { n: children.length - 1 })}
              onClick={() => setExpanded(isExpanded ? null : id)}
            >
              <MorphIcon icon={GitBranch} size={11} strokeWidth={1.75} />
              <span>{children.length - 1}</span>
            </button>
          )}
        </div>
        {isExpanded && (
          <div className="ml-5 flex flex-col self-stretch border-l border-line pl-1">
            {children.filter(child => !onPath.has(child)).map(child => row(child, true))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={6}
          className="z-[260] select-none outline-0"
        >
          {/* Focus opens on the cursor's row: the list reads root first, so the
              step the board is at is the one at the bottom, and focusing a row
              scrolls it into view as the panel opens. */}
          <Popover.Popup className={popup} initialFocus={cursorRef} data-history-panel>
            <header className="flex flex-none items-center gap-2 border-b border-line py-1.5 pr-2.5 pl-3.5">
              <Popover.Title className="m-0 text-[12.5px] font-bold">{t('History')}</Popover.Title>
              <span className="flex-1" />
              <span className="text-[10px] tabular-nums text-faint">
                {t('{n} steps', { n: path.length })}
                {offPath > 0 && ` · ${t('{n} variants', { n: offPath })}`}
              </span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
              {path.length === 0
                ? <p className="px-2.5 py-2 text-[11px] text-faint">{t('No steps yet')}</p>
                : path.map(id => row(id, false))}
            </div>
            <footer className="flex flex-none items-center gap-2 border-t border-line px-3.5 py-1 text-[10px] text-faint">
              {t('Click a step to go back to it')}
            </footer>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
