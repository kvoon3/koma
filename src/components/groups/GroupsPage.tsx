import type { RefObject } from 'react'
import type { TilesLayout } from '../../lib/groupPage'
import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useElementSize, useMediaQuery } from '../../hooks'
import { compactDockBand } from '../../lib/dockMetrics'
import { cellRatioValue } from '../../lib/gridTools'
import { tilesLayout } from '../../lib/groupPage'
import { useT } from '../../lib/i18n'
import { OVERVIEW_PATH } from '../../lib/routes'
import { viewTransitionOption } from '../../lib/viewTransition'
import { isTransparentBg, useStore } from '../../store'
import { useDockMetrics } from '../dockContext'
import { DockToolset } from '../Stage'
import { ToolsDock } from '../ToolsDock'
import { GroupWallpaper } from './GroupWallpaper'
import { AddTile, PageTile } from './PageCard'
import { useGroupsKeys } from './useGroupsKeys'
import { useGroupsNav } from './useGroupsNav'

/**
 * The groups page: every board group as a tile of one flat grid, opened from
 * the overview's Workspace capsule, a pull down or a long press. Tapping a
 * tile opens that group's overview through the `ws-<id>` morph, the dashed
 * tile adds a group (the page stays), and Done, Escape or Back leaves. The
 * tools dock rides along in its compact icon row.
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
  const navigate = useNavigate()
  const { close: closeGroups } = useGroupsNav()

  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const metrics = useDockMetrics()
  const coarse = useMediaQuery('(pointer: coarse)')
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  const layout = useMemo(
    () => tilesLayout({
      stageW: stage.w,
      stageH: stage.h,
      count: grids.length,
      dockBand: compactDockBand(metrics),
      coarse,
      ratio: cellRatioValue(gridCellRatio),
      gridGap,
    }),
    [stage.w, stage.h, grids.length, metrics, coarse, gridCellRatio, gridGap],
  )
  const activeIndex = Math.max(0, grids.findIndex(g => g.id === activeGridId))
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

  // Tap a tile: swap the store first, in its own flush, so the navigation's
  // old snapshot already carries the tapped tile's `ws-<id>` names; then leave
  // for the overview, where the same names morph its cells into place. The
  // open group's tile skips the switch (it already wears the names).
  const openGroup = useCallback((id: string) => {
    if (id !== activeGridId) {
      // eslint-disable-next-line react/dom-no-flush-sync -- the switch must land before the transition takes its old snapshot
      flushSync(() => {
        switchGrid(id)
      })
    }
    void navigate({ to: OVERVIEW_PATH, replace: true, viewTransition: viewTransitionOption() })
  }, [activeGridId, navigate, switchGrid])

  const keys = useGroupsKeys({ onLeave: closeGroups })

  const addGroup = useCallback(() => {
    addGrid()
  }, [addGrid])
  const deleteGroup = useCallback((id: string) => {
    removeGrid(id)
  }, [removeGrid])

  // The heading takes focus on entry, so the page's Escape exit is live and a
  // screen reader announces the fresh page.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const activeName = grids[activeIndex]?.name ?? ''
  const live = t('Group {name}', { name: activeName })
  const groupTiles = layout.tiles.slice(0, grids.length)
  const addBox = layout.tiles[grids.length] ?? null

  return (
    <div
      ref={stageRef}
      data-groups-page=""
      data-groups-active={activeGridId}
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

      {/* The tiles: every group at once, plus the dashed add slot while there
          is room. Each is a button, so Tab and Enter reach them natively. */}
      <div data-groups-tiles="" className="absolute inset-0 z-[5]">
        {groupTiles.map((box, i) => (
          <PageTile
            key={grids[i].id}
            group={grids[i]}
            board={boardOf(i)}
            box={box}
            layout={layout}
            open={i === activeIndex}
            named={i === activeIndex}
            photoById={photoById}
            transparent={transparent}
            canDelete={grids.length > 1}
            onOpen={openGroup}
            onDelete={deleteGroup}
          />
        ))}
        {addBox && <AddTile box={addBox} radius={layout.radius} onAdd={addGroup} />}
      </div>

      <GroupsHeader layout={layout} onDone={closeGroups} headingRef={headingRef} />
      <p aria-live="polite" aria-atomic="true" className="sr-only">{live}</p>

      <ToolsDock hidden={false} compact contextKey="groups">
        <DockToolset route="grid" />
      </ToolsDock>
    </div>
  )
}

/** The page chrome: the check-mark Done pill. The title stays for screen readers. */
function GroupsHeader({ layout, onDone, headingRef }: {
  layout: TilesLayout
  onDone: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const t = useT()
  return (
    <header
      data-groups-header=""
      className="pointer-events-none absolute inset-x-0 top-0 z-20"
      style={{ height: layout.headerH }}
    >
      <h1 ref={headingRef} tabIndex={-1} className="sr-only m-0 outline-0">{t('Groups')}</h1>
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
    </header>
  )
}
