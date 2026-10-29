import type { RefObject } from 'react'
import type { Photo } from '../../lib/imageStore'
import type { OverviewMode } from '../../lib/overviewMode'
import type { BoardCells } from './overviewLayout'
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import { Fragment, memo } from 'react'
import { BoardPage } from './BoardPage'

/**
 * The page viewport and its track: every board is a page laid at `i * travel`
 * in canvas px, while the gesture hook translates the track by
 * `-activeIdx * travel + pan / viewScale`. The clip is one board wide, so at
 * rest no neighbour shows, and only the live page is interactive.
 */
export interface TrackPage {
  id: string
  board: BoardCells
}

export const BoardTrack = memo(({ pages, activeIdx, travel, boardW, slotH, cell, box, gap, mode, trackRef, sortableIds, highlighted, viewScale, photoById, transparent, onEnter, onDelete }: {
  pages: readonly TrackPage[]
  activeIdx: number
  /** Page spacing, canvas px. */
  travel: number
  boardW: number
  slotH: number
  cell: number
  box: { w: number, h: number }
  gap: number
  mode: OverviewMode
  trackRef: RefObject<HTMLDivElement | null>
  sortableIds: readonly string[]
  highlighted: number
  viewScale: number
  photoById: Map<string, Photo>
  transparent: boolean
  onEnter: (id: string) => void
  onDelete: (id: string) => void
}) => {
  return (
    <div data-board-viewport="" className="relative overflow-hidden" style={{ width: boardW, height: slotH }}>
      <div ref={trackRef} data-board-track="" className="absolute inset-0 will-change-transform">
        {pages.map((page, i) => {
          const live = i === activeIdx
          const content = (
            <BoardPage
              pageId={page.id}
              board={page.board}
              live={live}
              mode={mode}
              left={i * travel}
              boardW={boardW}
              slotH={slotH}
              cell={cell}
              box={box}
              gap={gap}
              photoById={photoById}
              transparent={transparent}
              highlighted={live ? highlighted : -1}
              viewScale={viewScale}
              onEnter={onEnter}
              onDelete={onDelete}
            />
          )
          return live
            ? (
                <SortableContext key={page.id} items={sortableIds as string[]} strategy={rectSortingStrategy}>
                  {content}
                </SortableContext>
              )
            : <Fragment key={page.id}>{content}</Fragment>
        })}
      </div>
    </div>
  )
})
