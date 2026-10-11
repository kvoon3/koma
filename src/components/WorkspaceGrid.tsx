import type { Photo } from '../lib/imageStore'
import type { Leaf, Node, Rect } from '../lib/panes'
import { ImagePlus } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementSize, usePreview } from '../hooks'
import { fontById } from '../lib/fonts'
import { labelColors, layoutTree, leafList, placement } from '../lib/panes'
import { isTransparentBg, useStore } from '../store'

// Virtual canvas short side for preview layout math. Any value works — the
// tree layout is resolution-independent, only the ratio matters.
const PV = 400

/** One leaf of a workspace preview: the photo, panned/zoomed like the editor. */
function PreviewLeaf({ leaf, rect, k, unit, photoById }: {
  leaf: Leaf
  rect: Rect
  /** Virtual→cell scale factor. */
  k: number
  /** Cell-normalized unit (short side / 1000), for radius scaling. */
  unit: number
  photoById: Map<string, Photo>
}) {
  const photo = leaf.photoId ? photoById.get(leaf.photoId) : undefined
  const preview = usePreview(photo ?? null)
  const radius = useStore(s => s.radius)
  const iw = preview?.w ?? 0
  const ih = preview?.h ?? 0
  const style: React.CSSProperties = {
    left: rect.x * k,
    top: rect.y * k,
    width: rect.w * k,
    height: rect.h * k,
    borderRadius: radius * unit,
  }
  const place = iw && ih
    ? placement({ x: 0, y: 0, w: rect.w * k, h: rect.h * k }, leaf, iw, ih)
    : null
  return (
    <div className="absolute overflow-hidden bg-pane-bg" style={style}>
      {preview && place
        ? (
            <img
              src={preview.url}
              alt=""
              draggable={false}
              className="block max-w-none"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transformOrigin: '0 0',
                transform: `translate(${place.x}px, ${place.y}px) scale(${place.scale})`,
              }}
            />
          )
        : null}
      {leaf.label && leaf.label.text.trim() && (
        <span
          className="absolute whitespace-pre leading-[normal]"
          style={{
            left: `${leaf.label.x * 100}%`,
            top: `${leaf.label.y * 100}%`,
            transform: 'translate(-50%, -50%)',
            fontSize: leaf.label.size * unit,
            fontFamily: fontById(leaf.label.font).cssStack,
            background: labelColors(leaf.label.theme).bg,
            color: labelColors(leaf.label.theme).fg,
            padding: '0.22em 0.38em',
          }}
        >
          {leaf.label.text}
        </span>
      )}
    </div>
  )
}

/** Read-only live preview of a workspace's full collage in a square cell. */
function CellPreview({ root, canvasRatio, box, photoById }: {
  root: Node
  canvasRatio: number | null
  box: { w: number, h: number }
  photoById: Map<string, Photo>
}) {
  const bg = useStore(s => s.bg)
  const VW = PV
  const VH = Math.round(PV / (canvasRatio ?? 1.5))
  const view = useMemo(() => layoutTree(root, VW, VH, 0), [root, VW, VH])
  // Cover-fit: scale the workspace's own aspect up so it fills the whole
  // square cell, centered — the overflow is cropped away (Moments style).
  const k = Math.max(box.w / VW, box.h / VH)
  // Center the oversized preview box: negative offsets + half overflow.
  const pw = VW * k
  const ph = VH * k
  // Font/radius unit follows the canvas short edge, like the editor.
  const unit = (Math.min(VW, VH) / 1000) * k
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={`absolute top-1/2 left-1/2 ${isTransparentBg(bg) ? ' stage-clear' : ''}`}
        style={{
          width: pw,
          height: ph,
          transform: 'translate(-50%, -50%)',
          background: isTransparentBg(bg) ? undefined : bg,
        }}
      >
        {view.leaves.map(({ node, rect }) => (
          <PreviewLeaf key={node.id} leaf={node} rect={rect} k={k} unit={unit} photoById={photoById} />
        ))}
      </div>
    </div>
  )
}

function step(from: number, dir: 'left' | 'right' | 'up' | 'down' | 'next') {
  if (dir === 'next')
    return (from + 1) % 9
  const r = Math.floor(from / 3)
  const c = from % 3
  if (dir === 'left')
    return r * 3 + ((c + 2) % 3)
  if (dir === 'right')
    return r * 3 + ((c + 1) % 3)
  if (dir === 'up')
    return ((r + 2) % 3) * 3 + c
  return ((r + 1) % 3) * 3 + c
}

/**
 * The 3×3 workspace overview: read-only square previews of all nine
 * workspaces. Click a cell to edit that workspace, drag a cell onto another
 * to insert-shift reorder, arrows/hjkl/Tab + Enter to navigate by keyboard.
 * Pure navigation view — no photo tools.
 */
export function WorkspaceGrid() {
  const workspaces = useStore(s => s.workspaces)
  const activeId = useStore(s => s.activeId)
  const photos = useStore(s => s.photos)
  const bg = useStore(s => s.bg)
  const enterWorkspace = useStore(s => s.enterWorkspace)
  const moveWorkspace = useStore(s => s.moveWorkspace)

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])

  // Keyboard highlight: starts on the workspace we just left.
  const [hl, setHl] = useState(() => {
    const i = workspaces.findIndex(w => w.id === activeId)
    return i === -1 ? 0 : i
  })
  const hlRef = useRef(hl)
  hlRef.current = hl

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
        return
      const k = e.key
      const dirKey
        = k === 'h' || k === 'H' || k === 'ArrowLeft'
          ? 'left'
          : k === 'l' || k === 'L' || k === 'ArrowRight'
            ? 'right'
            : k === 'k' || k === 'K' || k === 'ArrowUp'
              ? 'up'
              : k === 'j' || k === 'J' || k === 'ArrowDown'
                ? 'down'
                : null
      if (dirKey) {
        e.preventDefault()
        setHl(step(hlRef.current, dirKey))
        return
      }
      if (k === 'Tab') {
        e.preventDefault()
        setHl(step(hlRef.current, 'next'))
        return
      }
      if (k === 'Enter') {
        e.preventDefault()
        const ws = useStore.getState().workspaces[hlRef.current]
        if (ws)
          useStore.getState().enterWorkspace(ws.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- Drag-to-reorder (insert-shift) -------------------------------------
  // Plain click = enter workspace. Drag = pick up on pointerdown, hover
  // highlights the insertion slot, reorder commits on pointerup if the
  // pointer moved to a different cell (that click never enters).
  const [drag, setDrag] = useState<{ from: number, over: number, moved: boolean } | null>(null)
  const cellElsRef = useRef<(HTMLButtonElement | null)[]>([])
  const dragStartRef = useRef({ x: 0, y: 0 })

  const onCellPointerDown = useCallback((idx: number) => (e: React.PointerEvent) => {
    if (e.button !== 0)
      return
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setDrag({ from: idx, over: idx, moved: false })
  }, [])

  useEffect(() => {
    if (!drag)
      return
    const move = (e: PointerEvent) => {
      const moved = Math.hypot(
        e.clientX - dragStartRef.current.x,
        e.clientY - dragStartRef.current.y,
      ) > 6
      const hit = cellElsRef.current.findIndex((el) => {
        if (!el)
          return false
        const r = el.getBoundingClientRect()
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      })
      setDrag(d => (d && (moved !== d.moved || (hit >= 0 && hit !== d.over))
        ? { ...d, moved: d.moved || moved, over: hit >= 0 ? hit : d.over }
        : d))
    }
    const up = () => {
      const d = drag
      setDrag(null)
      if (d && d.moved && d.over !== d.from) {
        const ws = useStore.getState().workspaces[d.from]
        if (ws)
          moveWorkspace(ws.id, d.over)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, moveWorkspace])

  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  const GAP_PX = 10
  const cell = Math.max(60, Math.floor(
    Math.min((wrapSize.w - 48 - GAP_PX * 2) / 3, (wrapSize.h - 48 - GAP_PX * 2) / 3, 220),
  ))
  const box = { w: cell, h: cell }

  const transparent = isTransparentBg(bg)

  return (
    <div ref={wrapRef} className="stage-checker absolute inset-0 flex touch-none items-center justify-center overflow-hidden">
      <div
        className="grid grid-cols-3"
        style={{ gap: GAP_PX, width: cell * 3 + GAP_PX * 2 }}
      >
        {workspaces.map((ws, i) => {
          const filled = leafList(ws.root).some(l => l.photoId)
          const isHl = hl === i
          const isDragging = drag?.from === i && drag.moved
          const isOver = drag?.over === i && drag.moved && drag.over !== drag.from
          return (
            <button
              key={ws.id}
              ref={(el) => { cellElsRef.current[i] = el }}
              className={`relative cursor-pointer touch-none select-none overflow-hidden bg-panel-2 outline-0 transition-[transform,opacity,outline-color] duration-[160ms] ${
                isDragging ? ' z-10 scale-[0.92] opacity-60' : ''
              }${isHl || isOver ? ' outline-2 -outline-offset-2' : ''}${isOver ? ' outline-accent' : isHl ? ' outline-txt' : ''}`}
              style={{ width: cell, height: cell }}
              onPointerDown={onCellPointerDown(i)}
              onClick={() => {
                if (!drag)
                  enterWorkspace(ws.id)
              }}
              title={filled ? 'Edit this workspace' : 'Start a new collage here'}
            >
              {filled
                ? (
                    <div className={`absolute inset-0 ${transparent ? ' stage-clear' : ''}`}>
                      <CellPreview root={ws.root} canvasRatio={ws.canvasRatio} box={box} photoById={photoById} />
                    </div>
                  )
                : (
                    <span className="absolute inset-0 grid place-items-center border border-dashed border-line-strong bg-panel-2 text-faint">
                      <MorphIcon icon={ImagePlus} size={22} strokeWidth={1.75} />
                    </span>
                  )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
