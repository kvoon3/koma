import type { TrailPoint } from './motionTrail'

/** The grid's slot geometry, in board px. */
export interface GridGeometry {
  cell: number
  cellH: number
  gap: number
}

export interface CellMove {
  id: string
  from: TrailPoint
  to: TrailPoint
}

const COLUMNS = 3

/** The top-left of a cell's slot, in board px. */
export function slotPoint(index: number, geo: GridGeometry): TrailPoint {
  return {
    x: (index % COLUMNS) * (geo.cell + geo.gap),
    y: Math.floor(index / COLUMNS) * (geo.cellH + geo.gap),
  }
}

/** From/to for each cell that changed slot. Identities and new ids are absent. */
export function cellMoves(prev: readonly { id: string }[], next: readonly { id: string }[], geo: GridGeometry): CellMove[] {
  const before = new Map(prev.map((w, i) => [w.id, i]))
  const moves: CellMove[] = []
  next.forEach((w, i) => {
    const from = before.get(w.id)
    if (from == null || from === i)
      return
    moves.push({ id: w.id, from: slotPoint(from, geo), to: slotPoint(i, geo) })
  })
  return moves
}

/** A mover's position at eased progress 0..1. */
export function moveAt(move: CellMove, eased: number): TrailPoint {
  return {
    x: move.from.x + (move.to.x - move.from.x) * eased,
    y: move.from.y + (move.to.y - move.from.y) * eased,
  }
}
