/**
 * The workspace switcher (Mission Control style) and the boards it pans over.
 *
 * A frosted, full-width strip near the top of the stage holds one card per
 * group: a 16:10 thumbnail of its board (every cell the grid's own preview),
 * the open group's card wearing the selection ring and standing slightly
 * larger. The bare + at the strip's right edge copies the open board into a new
 * group; the × on a card's corner deletes it (never the last one; both ride the
 * undo stack, no confirm). The strip is for browsing only: it scrolls and snaps,
 * while the open group changes through the board pager (`lib/boardPager`) or a
 * card click. The backdrop or Esc returns to the overview as it was.
 *
 * This file is the switcher's own surface: the strip, the cards, and the pager
 * boards plus the gesture layer they are dragged on. The physics behind that
 * layer (the snap, the fling, the pull-up exit) live in `grid/useBoardPager`.
 */
import type { ReactNode, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { Photo } from '../../lib/imageStore'
import type { Node, PaneLabel, Sticker } from '../../lib/panes'
import type { BoardCells } from './switcherLayout'
import { Plus, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useLayoutEffect, useRef } from 'react'
import { useElementSize } from '../../hooks'
import { useT } from '../../lib/i18n'
import { leafList } from '../../lib/panes'
import { MAX_GRIDS, MAX_WORKSPACES } from '../../lib/workspaces'
import { useStore } from '../../store'
import { AddSlotFrame, CellBody, CellPreview } from './CellPreview'
import { CARD_GAP, CARD_SCALE, RECEDE_BLUR, RECEDE_OPACITY, STRIP_GAP } from './switcherLayout'

/** Stable keys for the slots a board has not filled (a board holds nine). */
const EMPTY_SLOT_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'] as const

/**
 * The workspace switcher, Mission Control style.
 *
 * `ringId` is the card the ring leans on while a pager drag is under way (the
 * neighbour a release there would land on); `children` is the board pager's
 * gesture surface, which has to sit above the dim and below the strip.
 */
export function WorkspaceSwitcher({ stripTop, stripH, cardW, cardH, ringId, photoById, transparent, onPick, children }: {
  /** The strip's box within the stage, from `switcherMetrics`. */
  stripTop: number
  stripH: number
  cardW: number
  cardH: number
  /** The card wearing the ring, when a drag leans onto it (null = the open group's). */
  ringId: string | null
  photoById: Map<string, Photo>
  transparent: boolean
  /** null = leave without switching; a group id = zoom back into that board. */
  onPick: (gridId: string | null) => void
  /** The pager surface: over the dim, under the strip. */
  children?: ReactNode
}) {
  const t = useT()
  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)
  const parked = useStore(s => s.parkedBoards)
  const workspaces = useStore(s => s.workspaces)
  const [stripBoxRef, stripSize] = useElementSize<HTMLDivElement>()
  const cardRef = useRef(new Map<string, HTMLDivElement>())

  const boardOfGroup = (id: string) => (id === activeGridId ? workspaces : parked[id]?.workspaces ?? [])

  // Keep the open group's card centred: on open, and whenever a + / × / undo
  // moves which card the ring sits on. The strip browses (scroll-snap, free
  // scrolling) but never switches the group: the ring follows the open group,
  // and the pager is the one way to change it.
  useLayoutEffect(() => {
    const strip = stripBoxRef.current
    const card = cardRef.current.get(activeGridId)
    if (!strip || !card)
      return
    strip.scrollLeft = card.offsetLeft + card.offsetWidth / 2 - strip.clientWidth / 2
  }, [activeGridId, cardW, grids.length, stripBoxRef])

  // Every card's inner 3×3 at card size (hairline border takes 1px a side).
  const cellW = (cardW - 2 - 2 * CARD_GAP) / 3
  const cellH = (cardH - 2 - 2 * CARD_GAP) / 3

  // Air either side of the card row lets the first and last card centre under
  // scroll-snap; the same value is the strip's scroll padding. The port is the
  // strip less the edge padding (8px a side) and the 40px add glyph.
  const scrollPort = Math.max(0, stripSize.w - 16 - 40)
  const inset = Math.max(12, Math.round((scrollPort - cardW) / 2))

  return (
    <div data-switcher="" className="absolute inset-0 z-20">
      {/* The dim between the strip and the receding board; clicking it is the
          way back to the overview as it was. A button, so the keyboard has the
          same exit the pointer has (Esc and the pull-up are the other two). */}
      <button
        type="button"
        data-switcher-dim=""
        aria-label={t('Back to the grid')}
        className="absolute inset-0 cursor-pointer bg-overlay-dim outline-0 focus-visible:outline-1 focus-visible:outline-accent"
        onClick={() => onPick(null)}
      />

      {children}

      <div
        data-switcher-strip=""
        className="absolute inset-x-0 flex items-stretch gap-1 overflow-hidden border-y border-line bg-panel-2/75 px-2 shadow-pop backdrop-blur-xl backdrop-saturate-150"
        style={{ top: stripTop, height: stripH, viewTransitionName: 'ws-strip' }}
      >
        <div
          ref={stripBoxRef}
          data-switcher-cards=""
          className="flex min-w-0 snap-x snap-mandatory flex-1 touch-pan-x items-center overscroll-x-contain overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ gap: STRIP_GAP, paddingInline: inset, scrollPaddingInline: inset }}
        >
          {grids.map((g) => {
            const active = g.id === activeGridId
            const ringed = g.id === (ringId ?? activeGridId)
            const board = boardOfGroup(g.id)
            return (
              <div
                key={g.id}
                ref={(node) => {
                  if (node)
                    cardRef.current.set(g.id, node)
                  else
                    cardRef.current.delete(g.id)
                }}
                data-switcher-card=""
                data-card-active={active || undefined}
                data-card-ring={ringed || undefined}
                className="group/card relative flex shrink-0 snap-center items-center transition-[scale] duration-(--dur-fast)"
                style={{ width: cardW, scale: ringed ? CARD_SCALE : 1 }}
              >
                <button
                  type="button"
                  data-card-face=""
                  className={`relative block cursor-pointer overflow-hidden border bg-pane-bg shadow-pop outline-0 transition-[outline-color] duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-sel ${
                    ringed
                      ? ' border-line-strong outline-2 outline-offset-1 outline-sel'
                      : ' border-line outline-2 outline-offset-1 outline-transparent hover:not-focus-visible:outline-line-strong'
                  }`}
                  style={{ width: cardW, height: cardH }}
                  aria-label={t('Open group {name}', { name: g.name })}
                  onClick={() => onPick(g.id)}
                >
                  <span aria-hidden className="grid h-full w-full grid-cols-3" style={{ gap: CARD_GAP }}>
                    {board.map(ws => (
                      <CardCell
                        key={ws.id}
                        ws={ws}
                        box={{ w: cellW, h: cellH }}
                        photoById={photoById}
                        transparent={transparent}
                      />
                    ))}
                    {/* A board is always nine slots: the ones past its last
                        cell stay drawn as quiet squares, so the thumbnail
                        reads as the 3×3 it is. */}
                    {EMPTY_SLOT_KEYS.slice(0, MAX_WORKSPACES - board.length).map(key => (
                      <span key={key} aria-hidden className="border border-line bg-pane-empty" />
                    ))}
                  </span>
                </button>
                {grids.length > 1 && (
                  <button
                    type="button"
                    data-card-delete=""
                    className="pointer-coarse:opacity-100 absolute -top-1.5 -left-1.5 z-10 grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-float-line bg-float-bg text-float-icon opacity-0 shadow-pop transition-[opacity,background-color,color,scale] duration-(--dur-fast) group-hover/card:opacity-100 hover:text-danger focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97]"
                    aria-label={t('Delete group?')}
                    title={t('Delete group?')}
                    onClick={() => useStore.getState().removeGrid(g.id)}
                  >
                    <MorphIcon icon={X} size={11} strokeWidth={2} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* The bare + at the strip's right edge: a new group that copies the
            open board (photos shared, ids fresh) and opens it. Undoable. On a
            coarse pointer the lane widens to a 44px tap target; the glyph
            itself stays 22px. */}
        <button
          type="button"
          data-switcher-add=""
          className="grid w-10 shrink-0 cursor-pointer place-items-center text-dim outline-0 transition-[color,scale] duration-(--dur-fast) hover:text-txt focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97] disabled:cursor-default disabled:opacity-35 pointer-coarse:min-h-11 pointer-coarse:w-11"
          disabled={grids.length >= MAX_GRIDS}
          aria-label={t('Add a group')}
          title={t('Add a group')}
          onClick={() => useStore.getState().addGrid()}
        >
          <MorphIcon icon={Plus} size={22} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

/** One cell of a card's 3×3 thumbnail: the grid's own preview at card size; an empty slot stays a quiet square (no glyph, no hint). */
function CardCell({ ws, box, photoById, transparent }: {
  ws: { root: Node, canvasRatio: number | null, stickers?: Sticker[], labels?: PaneLabel[] }
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
}) {
  const filled = leafList(ws.root).some(l => l.photoId)
  return (
    <span data-card-cell="" className={`relative block overflow-hidden ${filled ? ' bg-pane-bg' : ' border border-line bg-pane-empty'}`}>
      {filled
        ? (
            <div className={`absolute inset-0 ${transparent ? ' stage-clear' : ''}`}>
              <CellPreview root={ws.root} canvasRatio={ws.canvasRatio} box={box} photoById={photoById} stickers={ws.stickers ?? []} labels={ws.labels ?? []} />
            </div>
          )
        : null}
    </span>
  )
}

/**
 * A neighbouring group's board on the pager: the same 3×3 the receded board
 * draws (the grid's own cell previews, at the same cell size and gap), shrunk
 * by the recede scale and dimmed / blurred to match it, so the two boards slide
 * past each other as one plane. It sits a page to its side of the live board
 * (`--pager-travel`, from the measured board) and is read-only.
 */
function PagerBoard({ side, board, cell, box, gap, boardW, scale, photoById, transparent }: {
  side: 'prev' | 'next'
  board: BoardCells
  cell: number
  box: { w: number, h: number }
  gap: number
  boardW: number
  /** The scale the live board receded by: the neighbour has to wear the same one. */
  scale: number
  photoById: Map<string, Photo>
  transparent: boolean
}) {
  // The board pans inside the column's scale, so the page is measured in
  // screen px while the content is laid out at full size.
  const offset = side === 'prev' ? 'calc(var(--pager-travel, 0px) * -1)' : 'var(--pager-travel, 0px)'
  return (
    <div
      data-pager-board={side}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 origin-top-left"
      style={{
        width: boardW,
        transform: `translateX(${offset}) scale(${scale})`,
        opacity: RECEDE_OPACITY,
        filter: `blur(${RECEDE_BLUR}px)`,
      }}
    >
      <div className="grid grid-cols-3" style={{ gap, width: boardW }}>
        {board.map(ws => (
          <div key={ws.id} className="relative overflow-hidden bg-panel-2" style={{ width: cell, height: box.h }}>
            <CellBody ws={ws} box={box} photoById={photoById} transparent={transparent} dimmed={false} quiet />
          </div>
        ))}
        {board.length < MAX_WORKSPACES && (
          <span className="relative grid place-items-center text-dim" style={{ width: cell, height: box.h }}>
            <AddSlotFrame cell={cell} cellH={box.h} />
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The pager's gesture layer: an invisible surface laid exactly over the receded
 * board (measured by the caller), carrying the live board's neighbours a page
 * either side. The pointer handlers come from the caller, which owns the drag
 * state, the physics and the pull-up exit.
 */
export function PagerSurface({ surfaceRef, trackRef, prevBoard, nextBoard, cell, box, gap, boardW, scale, photoById, transparent, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture }: {
  surfaceRef: RefObject<HTMLDivElement | null>
  trackRef: RefObject<HTMLDivElement | null>
  /** The neighbouring boards present in the row (absent at its ends). */
  prevBoard?: BoardCells
  nextBoard?: BoardCells
  cell: number
  box: { w: number, h: number }
  gap: number
  boardW: number
  /** The scale the live board receded by (see `recedeFit`). */
  scale: number
  photoById: Map<string, Photo>
  transparent: boolean
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void
  onLostPointerCapture: () => void
}) {
  return (
    <div
      ref={surfaceRef}
      data-board-pager=""
      className="absolute touch-pan-y select-none overflow-hidden overscroll-x-contain"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDragStart={e => e.preventDefault()}
    >
      <div ref={trackRef} className="absolute inset-0">
        {prevBoard && <PagerBoard side="prev" board={prevBoard} cell={cell} box={box} gap={gap} boardW={boardW} scale={scale} photoById={photoById} transparent={transparent} />}
        {nextBoard && <PagerBoard side="next" board={nextBoard} cell={cell} box={box} gap={gap} boardW={boardW} scale={scale} photoById={photoById} transparent={transparent} />}
      </div>
    </div>
  )
}
