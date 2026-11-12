import type { RefObject } from 'react'
import type { Trail, TrailPoint } from '../../lib/motionTrail'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { cellMoves, moveAt } from '../../lib/gridShuffle'
import { cubicBezier, EASE_MORPH, MORPH_MS } from '../../lib/motionTokens'
import { createTrail } from '../../lib/motionTrail'
import { prefersReducedMotion } from '../../lib/viewTransition'
import { useStore } from '../../store'
import { createCellTrail, paintCellTrail } from './cellTrail'

interface Run {
  workspaces: readonly { id: string }[]
  frame: number
  cells: HTMLElement[]
  ghosts: HTMLElement[]
  /** The last painted top-left of each mover, for a mid-flight retarget. */
  points: Map<string, TrailPoint>
}

/**
 * Animate a Shuffle over the real cells and trail them. The store has already
 * applied the order; this inverts each mover to its old slot, then runs one
 * 260ms clock with the view transition's curve. The streak layer is ordinary
 * DOM, so it paints every frame.
 */
export function useGridShuffle({ boardRef, workspaces, cell, cellH, gap, shuffleSeq, dragId }: {
  boardRef: RefObject<HTMLDivElement | null>
  workspaces: readonly { id: string }[]
  cell: number
  cellH: number
  gap: number
  shuffleSeq: number
  dragId: string | null
}): void {
  const prevRef = useRef(workspaces)
  const seqRef = useRef(shuffleSeq)
  const runRef = useRef<Run | null>(null)
  const trailsRef = useRef(new Map<string, Trail>())

  const cancelRun = useCallback((clearCells = true) => {
    const run = runRef.current
    if (run?.frame)
      cancelAnimationFrame(run.frame)
    runRef.current = null
    for (const trail of trailsRef.current.values())
      trail.cancel()
    trailsRef.current.clear()
    if (clearCells && run) {
      for (const el of run.cells)
        el.style.translate = ''
      for (const ghost of run.ghosts)
        ghost.remove()
    }
  }, [])

  useLayoutEffect(() => {
    if (dragId != null) {
      cancelRun()
      prevRef.current = workspaces
      return
    }
    if (shuffleSeq === seqRef.current) {
      prevRef.current = workspaces
      return
    }
    const oldPoints = runRef.current ? new Map(runRef.current.points) : null
    cancelRun()
    seqRef.current = shuffleSeq
    const prev = prevRef.current
    prevRef.current = workspaces
    if (prefersReducedMotion() || dragId != null)
      return
    const moves = cellMoves(prev, workspaces, { cell, cellH, gap })
    if (!moves.length)
      return
    const board = boardRef.current
    const layer = board?.querySelector<HTMLElement>('[data-grid-trail]')
    if (!board || !layer)
      return
    const cells = new Map([...board.querySelectorAll<HTMLElement>('[data-cell-id]')]
      .map(el => [el.dataset.cellId!, el] as const))
    const run: Run = { workspaces, frame: 0, cells: [], ghosts: [], points: new Map() }
    const movers: { move: { id: string, from: TrailPoint, to: TrailPoint }, el: HTMLElement, trail: Trail }[] = []
    for (const move of moves) {
      const el = cells.get(move.id)
      if (!el)
        continue
      const from = oldPoints?.get(move.id) ?? move.from
      const ghost = createCellTrail(move.id, cell, cellH)
      layer.append(ghost)
      const trail = createTrail(paintCellTrail(ghost, cell, cellH))
      trail.begin(from)
      movers.push({ move: { ...move, from }, el, trail })
      run.cells.push(el)
      run.ghosts.push(ghost)
      run.points.set(move.id, from)
      el.style.translate = `${from.x - move.to.x}px ${from.y - move.to.y}px`
    }
    if (!movers.length)
      return
    for (const mover of movers)
      trailsRef.current.set(mover.move.id, mover.trail)
    runRef.current = run
    const startedAt = performance.now()
    const frame = (now: number) => {
      if (runRef.current !== run)
        return
      const state = useStore.getState()
      if (state.workspaces !== run.workspaces || movers.some(mover => !mover.el.isConnected)) {
        cancelRun()
        return
      }
      const progress = Math.min(1, (now - startedAt) / MORPH_MS)
      const eased = cubicBezier(EASE_MORPH, progress)
      for (const mover of movers) {
        const point = moveAt(mover.move, eased)
        mover.el.style.translate = `${point.x - mover.move.to.x}px ${point.y - mover.move.to.y}px`
        run.points.set(mover.move.id, point)
        mover.trail.push(point)
      }
      if (progress < 1) {
        run.frame = requestAnimationFrame(frame)
        return
      }
      run.frame = 0
      for (const mover of movers)
        mover.el.style.translate = ''
    }
    run.frame = requestAnimationFrame(frame)
  }, [boardRef, cancelRun, cell, cellH, dragId, gap, shuffleSeq, workspaces])

  useEffect(() => {
    const board = boardRef.current
    if (!board)
      return
    const observer = new ResizeObserver(() => cancelRun())
    observer.observe(board)
    return () => observer.disconnect()
  }, [boardRef, cancelRun])

  useEffect(() => () => cancelRun(), [cancelRun])
}
