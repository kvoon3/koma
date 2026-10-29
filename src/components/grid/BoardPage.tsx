/**
 * One board page: the live page (sortable cells, the + menu, the X badges in
 * jiggle) or a read-only neighbour (the same previews, no listeners). Every
 * page reserves the same slot height and is centred in it, so paging never
 * moves a board vertically.
 */
import type { Photo } from '../../lib/imageStore'
import type { OverviewMode } from '../../lib/overviewMode'
import type { BoardCells } from './overviewLayout'
import { MAX_WORKSPACES, MIN_WORKSPACES } from '../../lib/workspaces'
import { AddCell, SortableCell, StaticAddCell, StaticCell } from './CellTiles'
import { boardRows } from './overviewLayout'

export function BoardPage({ pageId, board, live, mode, left, boardW, slotH, cell, box, gap, photoById, transparent, highlighted, viewScale, onEnter, onDelete }: {
  pageId: string
  board: BoardCells
  live: boolean
  mode: OverviewMode
  /** The page's layout offset from the track's origin, canvas px. */
  left: number
  boardW: number
  slotH: number
  cell: number
  box: { w: number, h: number }
  gap: number
  photoById: Map<string, Photo>
  transparent: boolean
  /** The keyboard highlight's cell index (live page only). */
  highlighted: number
  viewScale: number
  onEnter: (id: string) => void
  onDelete: (id: string) => void
}) {
  const jiggle = mode === 'jiggle'
  const rows = boardRows(board.length)
  const boardH = rows * box.h + (rows - 1) * gap
  return (
    <div
      data-board-page=""
      data-board-page-id={pageId}
      data-board-page-active={live || undefined}
      aria-hidden={live ? undefined : true}
      className={`absolute top-0 ${live ? '' : 'pointer-events-none'}`}
      style={{ left, width: boardW, height: slotH }}
    >
      <div className="flex size-full items-center justify-center">
        <div className="grid grid-cols-3" style={{ gap, width: boardW, height: boardH }}>
          {board.map((ws, i) => (live
            ? (
                <SortableCell
                  key={ws.id}
                  ws={ws}
                  index={i}
                  cell={cell}
                  box={box}
                  photoById={photoById}
                  transparent={transparent}
                  highlighted={highlighted === i}
                  jiggle={jiggle}
                  canDelete={board.length > MIN_WORKSPACES}
                  viewScale={viewScale}
                  onEnter={onEnter}
                  onDelete={onDelete}
                />
              )
            : <StaticCell key={ws.id} ws={ws} cell={cell} box={box} photoById={photoById} transparent={transparent} />))}
          {board.length < MAX_WORKSPACES && (live
            ? <AddCell cell={cell} cellH={box.h} jiggle={jiggle} />
            : <StaticAddCell cell={cell} cellH={box.h} />)}
        </div>
      </div>
    </div>
  )
}
