import type { Photo } from '../lib/imageStore'
import type { Leaf, Rect, Sticker } from '../lib/panes'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { usePreview } from '../hooks'
import { clampLeaf, photoNorm, placement, stickerRect } from '../lib/panes'
import { MAX_ZOOM, MIN_ZOOM, useStore } from '../store'

function IconSplitDown() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}
function IconSplitRight() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function IconSticker() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6.2" cy="6.8" r="1.05" fill="currentColor" />
      <circle cx="9.8" cy="6.8" r="1.05" fill="currentColor" />
      <path d="M5.6 10.1q2.4 1.7 4.8 0" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function StickerView({
  paneId,
  st,
  photo,
  place,
  paneRect,
  toCanvas,
}: {
  paneId: string
  st: Sticker
  photo: Photo
  place: { x: number, y: number, w: number, h: number }
  paneRect: Rect
  toCanvas: (clientX: number, clientY: number) => { x: number, y: number }
}) {
  const preview = usePreview(photo)
  const removeSticker = useStore(s => s.removeSticker)
  const gestureRef = useRef<{
    mode: 'move' | 'resize'
    ocX: number
    ocY: number
    d0: number
    s0: number
  } | null>(null)

  if (!photo.trueW || !photo.trueH || !preview)
    return null
  const aspect = photo.trueW / photo.trueH
  const r = stickerRect(place, st, photo.trueW, photo.trueH, aspect)

  const onMoveDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gestureRef.current = { mode: 'move', ocX: 0, ocY: 0, d0: 0, s0: st.s }
  }
  const onMoveMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'move')
      return
    e.stopPropagation()
    const p = toCanvas(e.clientX, e.clientY)
    const n = photoNorm(place, p.x, p.y)
    useStore.getState().moveSticker(paneId, st.id, n.x, n.y)
  }

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const corner = toCanvas(e.clientX, e.clientY)
    const ocX = 2 * (r.x + r.w / 2) - corner.x
    const ocY = 2 * (r.y + r.h / 2) - corner.y
    gestureRef.current = {
      mode: 'resize',
      ocX,
      ocY,
      d0: Math.max(4, Math.hypot(corner.x - ocX, corner.y - ocY)),
      s0: st.s,
    }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'resize')
      return
    e.stopPropagation()
    const p = toCanvas(e.clientX, e.clientY)
    const dist = Math.hypot(p.x - g.ocX, p.y - g.ocY)
    const n = photoNorm(place, (g.ocX + p.x) / 2, (g.ocY + p.y) / 2)
    const s = useStore.getState()
    s.moveSticker(paneId, st.id, n.x, n.y)
    s.scaleSticker(paneId, st.id, g.s0 * (dist / g.d0))
  }

  const endGesture = () => {
    gestureRef.current = null
  }

  return (
    <div
      className="sticker"
      style={{ left: r.x - paneRect.x, top: r.y - paneRect.y, width: r.w, height: r.h }}
      title={photo.name}
      onPointerDown={onMoveDown}
      onPointerMove={onMoveMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <img src={preview.url} alt="" draggable={false} />
      <span
        className="stickerResize"
        title="Drag to resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
      <button
        className="stickerDel"
        title="Remove sticker"
        onPointerDown={e => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          removeSticker(paneId, st.id)
        }}
      >
        ×
      </button>
    </div>
  )
}

interface Props {
  leaf: Leaf
  rect: Rect
  radius: number
  photo: Photo | null
  photoById: Map<string, Photo>
  focused: boolean
  canClose: boolean
  onFocus: (id: string) => void
  onUpdate: (id: string, patch: Partial<Leaf>) => void
  onSplit: (id: string, dir: 'row' | 'column') => void
  onClose: (id: string) => void
}

function PaneImpl({
  leaf,
  rect,
  radius,
  photo,
  photoById,
  focused,
  canClose,
  onFocus,
  onUpdate,
  onSplit,
  onClose,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const preview = usePreview(photo)

  const pointersRef = useRef(new Map<number, { x: number, y: number }>())
  const gestureRef = useRef<{
    mode: 'pan' | 'pinch'
    lastX: number
    lastY: number
    startDist: number
    base: Leaf
  } | null>(null)
  const [dropping, setDropping] = useState(false)

  const iw = preview?.w ?? 0
  const ih = preview?.h ?? 0
  const cell: Rect = rect

  const local = useCallback((cx: number, cy: number) => {
    const r = elRef.current?.getBoundingClientRect()
    return r ? { x: cx - r.left, y: cy - r.top } : { x: 0, y: 0 }
  }, [])

  const commit = useCallback(
    (next: Leaf) => {
      if (!iw || !ih)
        return
      onUpdate(leaf.id, clampLeaf(next, cell, iw, ih))
    },
    [leaf.id, iw, ih, onUpdate, cell],
  )

  const zoomAbout = useCallback(
    (base: Leaf, nextZoom: number, mx: number, my: number) => {
      if (!iw || !ih)
        return
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
      const before = placement(cell, base, iw, ih)
      const u = (mx - before.x) / before.w
      const v = (my - before.y) / before.h
      const after = placement(cell, { ...base, zoom }, iw, ih)
      const tx = mx - u * after.w
      const ty = my - v * after.h
      commit({ ...base, zoom, cx: (cell.w / 2 - tx) / after.w, cy: (cell.h / 2 - ty) / after.h })
    },
    [iw, ih, commit, cell],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    onFocus(leaf.id)
    if (!leaf.photoId)
      return
    elRef.current?.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = local(e.clientX, e.clientY)
    if (pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      gestureRef.current = {
        mode: 'pinch',
        lastX: 0,
        lastY: 0,
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        base: { ...leaf },
      }
    }
    else {
      gestureRef.current = { mode: 'pan', lastX: p.x, lastY: p.y, startDist: 0, base: { ...leaf } }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId))
      return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gestureRef.current
    if (!g || !iw || !ih)
      return

    if (g.mode === 'pan' && pointersRef.current.size === 1) {
      const p = local(e.clientX, e.clientY)
      const dx = p.x - g.lastX
      const dy = p.y - g.lastY
      g.lastX = p.x
      g.lastY = p.y
      const pl = placement(cell, leaf, iw, ih)
      commit({ ...leaf, cx: leaf.cx - dx / pl.w, cy: leaf.cy - dy / pl.h })
      return
    }
    if (g.mode === 'pinch' && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2)
      zoomAbout(g.base, g.base.zoom * (dist / g.startDist), mid.x, mid.y)
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size === 0) {
      gestureRef.current = null
    }
    else {
      const only = [...pointersRef.current.values()][0]
      const p = local(only.x, only.y)
      gestureRef.current = { mode: 'pan', lastX: p.x, lastY: p.y, startDist: 0, base: { ...leaf } }
    }
  }

  useEffect(() => {
    const el = elRef.current
    if (!el)
      return
    const handler = (e: WheelEvent) => {
      if (!leaf.photoId || !iw || !ih)
        return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0012))
      const p = local(e.clientX, e.clientY)
      zoomAbout(leaf, leaf.zoom * factor, p.x, p.y)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [leaf, iw, ih, local, zoomAbout])

  const place = iw && ih ? placement(cell, leaf, iw, ih) : null

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const b = elRef.current?.getBoundingClientRect()
      const lx = b ? clientX - b.left : 0
      const ly = b ? clientY - b.top : 0
      return { x: rect.x + lx, y: rect.y + ly }
    },
    [rect.x, rect.y],
  )

  const pickingHere = useStore(s => s.stickerPick?.paneId === leaf.id)

  return (
    <div
      ref={elRef}
      className={
        `pane${
          focused ? ' focused' : ''
        }${leaf.photoId ? '' : ' empty'
        }${dropping ? ' dropping' : ''}`
      }
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: radius }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={() => leaf.photoId && onUpdate(leaf.id, { zoom: 1, cx: 0.5, cy: 0.5 })}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files'))
          return
        e.preventDefault()
        e.stopPropagation()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        const files = [...(e.dataTransfer?.files ?? [])].filter(f => f.type.startsWith('image/'))
        setDropping(false)
        if (!files.length)
          return
        e.preventDefault()
        e.stopPropagation()
        const s = useStore.getState()
        const created = s.addPhotos(files, false)
        const first = created[0]
        if (first)
          s.assign(leaf.id, first.id)
      }}
    >
      {preview && place
        ? (
            <img
              src={preview.url}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transformOrigin: '0 0',
                transform: `translate(${place.x - rect.x}px, ${place.y - rect.y}px) scale(${place.scale})`,
                maxWidth: 'none',
              }}
            />
          )
        : leaf.photoId
          ? (
              <div className="paneHint">Loading...</div>
            )
          : (
              <div className="paneHint">Drop a photo here</div>
            )}

      {place
        && leaf.stickers.map((st) => {
          const sp = st.photoId ? photoById.get(st.photoId) : undefined
          return sp
            ? (
                <StickerView
                  key={st.id}
                  paneId={leaf.id}
                  st={st}
                  photo={sp}
                  place={place}
                  paneRect={rect}
                  toCanvas={toCanvas}
                />
              )
            : null
        })}

      <div className="paneBar" onPointerDown={e => e.stopPropagation()}>
        <button
          className="paneBtn"
          title="Split top/bottom"
          onClick={(e) => {
            e.stopPropagation()
            onSplit(leaf.id, 'column')
          }}
        >
          <IconSplitDown />
        </button>
        <button
          className="paneBtn"
          title="Split left/right"
          onClick={(e) => {
            e.stopPropagation()
            onSplit(leaf.id, 'row')
          }}
        >
          <IconSplitRight />
        </button>
        {leaf.photoId && (
          <button
            className={`paneBtn${pickingHere ? ' on' : ''}`}
            title="Add a sticker (e.g. to cover a face)"
            onClick={(e) => {
              e.stopPropagation()
              const s = useStore.getState()
              if (s.stickerPick?.paneId === leaf.id) {
                s.cancelStickerPick()
                return
              }
              if (!place)
                return
              const nx = (rect.x + rect.w / 2 - place.x) / place.w
              const ny = (rect.y + rect.h / 2 - place.y) / place.h
              s.beginStickerPick(leaf.id, nx, ny)
              onFocus(leaf.id)
            }}
          >
            <IconSticker />
          </button>
        )}
      </div>

      {canClose && (
        <button
          className="paneClose"
          title="Close this pane"
          onPointerDown={e => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose(leaf.id)
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

export const Pane = memo(PaneImpl)
