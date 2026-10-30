import type { RefObject } from 'react'
import type { PageLayout } from '../../lib/groupPage'
import type { PagePager } from './usePagePager'
import { Check, Plus } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useElementSize, useMediaQuery } from '../../hooks'
import { compactDockBand } from '../../lib/dockMetrics'
import { cellRatioValue } from '../../lib/gridTools'
import { pageCardLeft, pageLayout } from '../../lib/groupPage'
import { useT } from '../../lib/i18n'
import { MAX_GRIDS } from '../../lib/workspaces'
import { isTransparentBg, useStore } from '../../store'
import { useDockMetrics } from '../dockContext'
import { DockToolset } from '../Stage'
import { ToolsDock } from '../ToolsDock'
import { GroupWallpaper } from './GroupWallpaper'
import { PageCard } from './PageCard'
import { PageDots } from './PageDots'
import { useGroupsKeys } from './useGroupsKeys'
import { useGroupsNav } from './useGroupsNav'
import { usePagePager } from './usePagePager'

/**
 * The groups page: one full-stage page card per board group, opened from the
 * overview's Workspace chip or a pull-down. Swiping switches the open group,
 * tapping the live card opens its overview, and Done, Escape or Back leaves.
 * The tools dock rides along in its compact icon row.
 */
export function GroupsPage() {
  const t = useT()
  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)
  const workspaces = useStore(s => s.workspaces)
  const parked = useStore(s => s.parkedBoards)
  const photos = useStore(s => s.photos)
  const bg = useStore(s => s.bg)
  const gridGap = useStore(s => s.gridGap)
  const gridCellRatio = useStore(s => s.gridCellRatio)
  const switchGrid = useStore(s => s.switchGrid)
  const addGrid = useStore(s => s.addGrid)
  const removeGrid = useStore(s => s.removeGrid)
  const { close: closeGroups } = useGroupsNav()

  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const metrics = useDockMetrics()
  const coarse = useMediaQuery('(pointer: coarse)')
  const reduce = !!useReducedMotion()
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const pagerRef = useRef<PagePager | null>(null)

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  const layout = useMemo(
    () => pageLayout({
      stageW: stage.w,
      stageH: stage.h,
      dockH: compactDockBand(metrics),
      ratio: cellRatioValue(gridCellRatio),
      gridGap,
      coarse,
    }),
    [stage.w, stage.h, metrics, gridCellRatio, gridGap, coarse],
  )
  const activeIndex = Math.max(0, grids.findIndex(g => g.id === activeGridId))
  const gridIds = useMemo(() => grids.map(g => g.id), [grids])
  const activeBoard = useMemo(
    () => (grids[activeIndex]?.id === activeGridId ? workspaces : parked[activeGridId]?.workspaces ?? workspaces),
    [grids, activeIndex, activeGridId, workspaces, parked],
  )
  const boardOf = useCallback((index: number) => {
    const id = grids[index]?.id
    if (!id)
      return []
    return id === activeGridId ? workspaces : parked[id]?.workspaces ?? []
  }, [grids, activeGridId, workspaces, parked])

  const leave = useCallback(() => {
    pagerRef.current?.reset()
    closeGroups()
  }, [closeGroups])

  const pager = usePagePager({ layout, gridIds, activeIndex, onSwitch: switchGrid, onOpen: leave, reduce })
  useLayoutEffect(() => {
    pagerRef.current = pager
  }, [pager])
  const keys = useGroupsKeys({ activeIndex, count: grids.length, goTo: pager.goTo, onOpen: leave })

  const addGroup = useCallback(() => {
    pagerRef.current?.reset()
    addGrid()
  }, [addGrid])
  const deleteGroup = useCallback((id: string) => {
    pagerRef.current?.reset()
    removeGrid(id)
  }, [removeGrid])

  // The heading takes focus on entry, so the page's own arrow map is live and a
  // screen reader announces the fresh page.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const activeName = grids[activeIndex]?.name ?? ''
  const live = `${t('Group {n} of {total}', { n: activeIndex + 1, total: grids.length })} · ${activeName}`
  const sideAir = (layout.stageW - layout.card.w) / 2
  const fade = Math.min(16, Math.max(8, sideAir - 4))
  const mask = `linear-gradient(to right, transparent 0, black ${fade}px, black calc(100% - ${fade}px), transparent 100%)`

  return (
    <div
      ref={stageRef}
      data-groups-page=""
      data-groups-active={activeGridId}
      data-groups-band={layout.band}
      role="region"
      aria-label={t('Groups')}
      className="absolute inset-0 touch-none select-none overflow-hidden bg-panel-2"
      onKeyDown={keys}
      onPointerUp={(e) => {
        // A press on the page's own surface (not its buttons) would leave focus
        // on the body, and with it the page's key map. The browser blurs on the
        // press, so put focus back on the heading at the release.
        if (!(e.target as HTMLElement).closest('button, a[href]'))
          headingRef.current?.focus({ preventScroll: true })
      }}
      onPointerCancel={() => headingRef.current?.focus({ preventScroll: true })}
    >
      <GroupWallpaper board={activeBoard} photoById={photoById} />

      {/* The carousel viewport is the only masked layer: the wallpaper, header
          and dots stay outside it, and the active card's margin is wider than
          the fade, so only cards crossing the stage edge reach zero alpha. */}
      <div
        data-page-viewport=""
        className="absolute inset-0 z-[5]"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        <div
          ref={pager.surfaceRef}
          {...pager.surfaceProps}
          data-page-surface=""
          className="absolute cursor-grab touch-pan-y select-none overflow-hidden overscroll-x-contain active:cursor-grabbing"
          style={pager.surfaceStyle}
        />
        <div
          ref={pager.trackRef}
          data-page-track=""
          className="pointer-events-none absolute inset-0 z-10"
        >
          {grids.map((group, i) => (
            <PageCard
              key={group.id}
              index={i}
              group={group}
              board={boardOf(i)}
              left={pageCardLeft(i, activeIndex, layout, 0)}
              layout={layout}
              active={i === activeIndex}
              named={i === activeIndex}
              photoById={photoById}
              transparent={transparent}
              canDelete={grids.length > 1}
              onRef={pager.registerCard}
              onDelete={deleteGroup}
            />
          ))}
        </div>
      </div>

      <GroupsHeader
        name={activeName}
        layout={layout}
        onDone={leave}
        onAdd={addGroup}
        canAdd={grids.length < MAX_GRIDS}
        headingRef={headingRef}
      />
      <PageDots
        count={grids.length}
        active={activeIndex}
        target={pager.targetIndex}
        layout={layout}
        names={grids.map(g => g.name)}
        onPick={pager.goTo}
      />
      <p aria-live="polite" aria-atomic="true" className="sr-only">{live}</p>

      <ToolsDock hidden={false} compact contextKey="groups">
        <DockToolset route="grid" />
      </ToolsDock>
    </div>
  )
}

/** The page chrome: the group title, the check-mark Done pill and the add button. */
function GroupsHeader({ name, layout, onDone, onAdd, canAdd, headingRef }: {
  name: string
  layout: PageLayout
  onDone: () => void
  onAdd: () => void
  canAdd: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const t = useT()
  const tight = layout.band === 'tight'
  return (
    <header
      data-groups-header=""
      className="pointer-events-none absolute inset-x-0 top-0 z-20"
      style={{ height: layout.headerH }}
    >
      <h1
        ref={headingRef}
        tabIndex={-1}
        className={`m-0 truncate text-center text-[15px] font-semibold text-txt outline-0 ${
          tight ? 'sr-only' : 'absolute inset-x-0 flex items-center justify-center px-24'
        }`}
        style={tight ? undefined : { height: layout.headerH }}
      >
        <span key={name} className="groups-name-in inline-block">{name}</span>
      </h1>
      <button
        type="button"
        data-groups-done=""
        className="pointer-events-auto absolute inline-flex cursor-pointer items-center justify-center gap-1 rounded-full border border-float-line bg-float-bg text-[12px] font-semibold text-txt shadow-pop outline-0 backdrop-blur-[7px] transition-[background-color,color,scale] duration-(--dur-fast) hover:bg-chip-hover focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97]"
        style={{ top: layout.done.top, right: layout.done.right, width: layout.done.w, height: layout.done.h }}
        onClick={onDone}
      >
        <MorphIcon icon={Check} size={13} strokeWidth={2.25} />
        {t('Done')}
      </button>
      <button
        type="button"
        data-groups-add=""
        className="pointer-events-auto absolute grid cursor-pointer place-items-center rounded-full border border-float-line bg-float-bg text-dim shadow-pop outline-0 backdrop-blur-[7px] transition-[background-color,color,scale] duration-(--dur-fast) hover:text-txt focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97] disabled:cursor-default disabled:opacity-35"
        style={{ top: layout.add.top, right: layout.add.right, width: layout.add.size, height: layout.add.size }}
        disabled={!canAdd}
        aria-label={t('Add a group')}
        title={t('Add a group')}
        onClick={onAdd}
      >
        <MorphIcon icon={Plus} size={18} strokeWidth={1.75} />
      </button>
    </header>
  )
}
