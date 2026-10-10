import type { FontMeta } from '../lib/fonts'
import type { Photo } from '../lib/imageStore'
import type { Leaf, PaneLabel, Rect, Sticker } from '../lib/panes'
import { ContextMenu } from '@base-ui/react/context-menu'
import { Select } from '@base-ui/react/select'
import { Check, ChevronDown, SquareSplitHorizontal, SquareSplitVertical, Sticker as StickerIcon, Type, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { usePreview } from '../hooks'
import { ensureFonts, FONT_CATALOG, fontById } from '../lib/fonts'
import { getLiveVideoUrl } from '../lib/imageStore'
import { clampLeaf, photoNorm, placement, stickerRect } from '../lib/panes'
import { MAX_ZOOM, MIN_ZOOM, useStore } from '../store'

const paneBtnCls = 'grid h-6 w-[26px] cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-float-icon pointer-coarse:h-[30px] pointer-coarse:w-8 hover:bg-chip-hover hover:text-txt'

const LABEL_FONT_ITEMS = [
  { value: '', label: 'System', cat: 'system' as FontMeta['cat'] },
  ...FONT_CATALOG.map(f => ({ value: f.id, label: f.label, cat: f.cat })),
]

const FONT_CATS: { id: FontMeta['cat'], label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'hand', label: 'Handwriting' },
  { id: 'mono', label: 'Mono' },
]

// Loads a Google font for the preview and bumps a counter once a web font finishes
// loading, so the label re-renders with the real metrics.
function useFontReady(font: string): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (fontById(font).gfFamily)
      void ensureFonts([font])
    const onDone = () => setTick(t => t + 1)
    document.fonts.addEventListener('loadingdone', onDone)
    return () => document.fonts.removeEventListener('loadingdone', onDone)
  }, [font])
  return tick
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
    useStore.getState().selectLabel(null)
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
      className="group/sticker absolute z-2 cursor-grab touch-none active:cursor-grabbing"
      style={{ left: r.x - paneRect.x, top: r.y - paneRect.y, width: r.w, height: r.h }}
      title={photo.name}
      onPointerDown={onMoveDown}
      onPointerMove={onMoveMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <img src={preview.url} alt="" draggable={false} className="block h-full w-full max-w-none pointer-events-none shadow-[0_2px_10px_rgba(0,0,0,0.35)]" />
      <span
        className="group-hover/sticker:opacity-100 absolute -right-2 -bottom-2 h-[15px] w-[15px] cursor-nwse-resize rounded-full border-2 border-float-bg-2 bg-accent opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-opacity duration-[120ms]"
        title="Drag to resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
      <button
        className="group-hover/sticker:opacity-100 absolute -top-[9px] -right-[9px] grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-full border border-float-bg-2 bg-danger p-0 text-xs leading-none text-on-accent opacity-0 transition-opacity duration-[120ms]"
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

function LabelView({
  paneId,
  lab,
  unit,
  editing,
  setEditing,
  elRef,
  onFocus,
}: {
  paneId: string
  lab: PaneLabel
  unit: number
  editing: boolean
  setEditing: (v: boolean) => void
  elRef: React.RefObject<HTMLDivElement | null>
  onFocus: (id: string) => void
}) {
  const setLabel = useStore(s => s.setLabel)
  const removeLabel = useStore(s => s.removeLabel)
  const selectLabel = useStore(s => s.selectLabel)
  const selected = useStore(s => s.labelSel === paneId)
  const fontTick = useFontReady(lab.font)
  // hover intent: keep the toolbar alive while the pointer crosses the gap to it
  const [hot, setHot] = useState(false)
  const leaveRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (leaveRef.current != null)
      window.clearTimeout(leaveRef.current)
  }, [])
  const textRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<{
    mode: 'move' | 'resize'
    cx: number
    cy: number
    d0: number
    s0: number
  } | null>(null)

  useEffect(() => {
    if (!editing)
      return
    const el = textRef.current
    if (!el)
      return
    el.focus()
    const sel = window.getSelection()
    if (!sel)
      return
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [editing])

  const onBoxDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (editing)
      return
    onFocus(paneId)
    selectLabel(paneId)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gestureRef.current = { mode: 'move', cx: 0, cy: 0, d0: 0, s0: lab.size }
  }
  const onBoxMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'move')
      return
    e.stopPropagation()
    const r = elRef.current?.getBoundingClientRect()
    if (!r)
      return
    setLabel(paneId, {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    })
  }

  const onSizeDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    const r = elRef.current?.getBoundingClientRect()
    if (!r)
      return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const cx = r.left + lab.x * r.width
    const cy = r.top + lab.y * r.height
    gestureRef.current = {
      mode: 'resize',
      cx,
      cy,
      d0: Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy)),
      s0: lab.size,
    }
  }
  const onSizeMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'resize')
      return
    e.stopPropagation()
    const dist = Math.hypot(e.clientX - g.cx, e.clientY - g.cy)
    setLabel(paneId, { size: g.s0 * (dist / g.d0) })
  }

  const endGesture = () => {
    gestureRef.current = null
  }

  const commit = () => {
    const el = textRef.current
    setEditing(false)
    if (!el)
      return
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text)
      removeLabel(paneId)
    else
      setLabel(paneId, { text })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing)
      return
    if (e.key !== 'Enter' && e.key !== 'Escape')
      return
    // keep Esc/Enter from reaching the global handler (Esc would deselect)
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    if (e.key === 'Enter')
      e.preventDefault()
    el.blur()
  }

  return (
    <div
      className={`group/label absolute z-2 touch-none bg-white px-[0.38em] py-[0.22em] leading-[normal] whitespace-pre text-black${
        editing ? ' cursor-text select-text outline-1 outline-txt outline-offset-3' : ' cursor-grab active:cursor-grabbing'
      }${selected ? ' outline-1 outline-txt outline-offset-3' : ''}`}
      data-font-tick={fontTick}
      style={{
        left: `${lab.x * 100}%`,
        top: `${lab.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        fontSize: `${lab.size * unit}px`,
        fontFamily: fontById(lab.font).cssStack,
      }}
      onPointerDown={onBoxDown}
      onPointerMove={onBoxMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerEnter={() => {
        if (leaveRef.current != null) {
          window.clearTimeout(leaveRef.current)
          leaveRef.current = null
        }
        setHot(true)
      }}
      onPointerLeave={() => {
        if (leaveRef.current != null)
          window.clearTimeout(leaveRef.current)
        leaveRef.current = window.setTimeout(() => {
          leaveRef.current = null
          setHot(false)
        }, 220)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
    >
      <div
        ref={textRef}
        contentEditable={editing}
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={onKeyDown}
      >
        {lab.text}
      </div>
      {!editing && (
        <span
          className={`group-hover/label:opacity-100 absolute -right-2 -bottom-2 h-[15px] w-[15px] cursor-nwse-resize rounded-none border-2 border-float-bg-2 bg-accent opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-opacity duration-[120ms]${hot || selected ? ' opacity-100' : ''}`}
          title="Drag to resize"
          onPointerDown={onSizeDown}
          onPointerMove={onSizeMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        />
      )}
      {!editing && (
        <button
          className={`group-hover/label:opacity-100 absolute -top-[9px] -right-[9px] grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-none border border-float-bg-2 bg-danger p-0 text-xs leading-none text-on-accent opacity-0 transition-opacity duration-[120ms]${hot || selected ? ' opacity-100' : ''}`}
          title="Remove label"
          onPointerDown={e => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            removeLabel(paneId)
          }}
        >
          ×
        </button>
      )}
      <div
        className={`group-hover/label:pointer-events-auto group-hover/label:opacity-100 pointer-events-none absolute left-1/2 z-[4] flex -translate-x-1/2 gap-[3px] rounded-none border border-float-line bg-float-bg p-[3px] opacity-0 backdrop-blur-[7px] transition-opacity duration-[140ms] ${
          lab.y < 0.3 ? 'bottom-auto top-[calc(100%+10px)]' : 'bottom-[calc(100%+10px)]'
        }${editing || hot || selected ? ' pointer-events-auto opacity-100' : ''}`}
        onPointerDown={(e) => {
          e.stopPropagation()
          selectLabel(paneId)
        }}
      >
        <Select.Root
          items={LABEL_FONT_ITEMS}
          value={lab.font}
          onValueChange={value => setLabel(paneId, { font: String(value) })}
        >
          <Select.Trigger className="box-border inline-flex h-[22px] min-w-[92px] max-w-[150px] cursor-pointer items-center justify-between gap-1.5 overflow-hidden rounded-none border border-float-line bg-float-bg-2 px-1.5 text-[11px] whitespace-nowrap text-txt hover:bg-chip-hover" title="Label font" aria-label="Label font">
            <Select.Value />
            <Select.Icon className="flex flex-none text-dim">
              <MorphIcon icon={ChevronDown} size={12} strokeWidth={1.75} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner
              className="z-[260] select-none outline-0"
              sideOffset={4}
              align="start"
              alignItemWithTrigger={false}
            >
              <Select.Popup className="box-border min-w-[var(--anchor-width)] rounded-none border border-line bg-panel py-1 text-txt outline-0 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
                <Select.List className="relative max-h-[var(--available-height)] overflow-y-auto">
                  {FONT_CATS.map((cat) => {
                    const items = LABEL_FONT_ITEMS.filter(i => i.cat === cat.id)
                    if (!items.length)
                      return null
                    return (
                      <Select.Group key={cat.id}>
                        <Select.GroupLabel className="px-2.5 pt-[5px] pb-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-faint">{cat.label}</Select.GroupLabel>
                        {items.map(item => (
                          <Select.Item
                            key={item.value || 'system'}
                            value={item.value}
                            className="flex cursor-default select-none items-center gap-2 px-2.5 py-[5px] text-[13px] outline-0 data-highlighted:bg-accent data-highlighted:text-on-accent"
                            style={{ fontFamily: fontById(item.value).cssStack }}
                          >
                            <Select.ItemIndicator className="flex w-3.5 text-current">
                              <MorphIcon icon={Check} size={12} strokeWidth={2} />
                            </Select.ItemIndicator>
                            <Select.ItemText className="flex-1">{item.label}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Group>
                    )
                  })}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>
    </div>
  )
}

interface Props {
  leaf: Leaf
  rect: Rect
  radius: number
  unit: number
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
  unit,
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
  const [editing, setEditing] = useState(false)

  // Live Photo: press and hold to play the paired video, release to stop.
  // `liveFor` records which photo the hold belongs to, so swapping the pane's
  // photo invalidates playback without an effect.
  const [liveFor, setLiveFor] = useState<string | null>(null)
  const liveVideoRef = useRef<HTMLVideoElement | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const downAtRef = useRef<{ x: number, y: number } | null>(null)
  const liveUrl = photo?.videoFile ? getLiveVideoUrl(photo) : null
  const live = liveFor != null && liveFor === (photo?.id ?? null) && !!liveUrl

  const clearHold = useCallback(() => {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearHold(), [clearHold])

  useEffect(() => {
    const v = liveVideoRef.current
    if (!v)
      return
    if (live) {
      v.currentTime = 0
      v.play().catch(() => {
        v.muted = true
        v.play().catch(() => {})
      })
    }
    else {
      v.pause()
    }
  }, [live, liveUrl])

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
    // Only the primary button focuses or starts a gesture. A right-click must
    // leave focus alone, otherwise this pane re-renders as focused and its
    // ContextMenu.Trigger unmounts before the swap menu can open.
    if (e.button !== 0)
      return
    onFocus(leaf.id)
    useStore.getState().selectLabel(null)
    if (!leaf.photoId)
      return
    elRef.current?.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = local(e.clientX, e.clientY)
    if (pointersRef.current.size >= 2) {
      clearHold()
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
      if (liveUrl) {
        downAtRef.current = { x: e.clientX, y: e.clientY }
        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = null
          downAtRef.current = null
          setLiveFor(photo?.id ?? null)
        }, 320)
      }
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
      // Dragging means panning, not holding — cancel the Live Photo timer.
      if (holdTimerRef.current != null && downAtRef.current
        && Math.hypot(e.clientX - downAtRef.current.x, e.clientY - downAtRef.current.y) > 5) {
        clearHold()
      }
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
      clearHold()
      downAtRef.current = null
      setLiveFor(null)
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
      // Pinch/ctrl+wheel must never fall through to browser page zoom, even
      // when this pane has nothing to zoom (the stage forwards these here).
      if (e.ctrlKey || (leaf.photoId && iw && ih))
        e.preventDefault()
      if (!leaf.photoId || !iw || !ih)
        return
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

  const swapWithFocused = useStore(s => s.swapPhotos)

  const paneNode = (
    <div
      ref={elRef}
      data-pane-id={leaf.id}
      className={
        `group/pane absolute cursor-grab touch-none overflow-hidden bg-pane-bg [contain:paint]${
          focused
            ? ' z-1 cursor-grab'
            : ''
        }${leaf.photoId ? '' : ' bg-pane-empty'}`
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
        const files = [...(e.dataTransfer?.files ?? [])]
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
      onContextMenu={e => e.preventDefault()}
    >
      {preview && place
        ? (
            <img
              src={preview.url}
              alt=""
              draggable={false}
              className="block max-w-none will-change-transform"
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
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-pane-hint">Loading...</div>
            )
          : (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-pane-hint">Drop a photo here</div>
            )}

      {liveUrl && place && (
        <video
          ref={liveVideoRef}
          className={`absolute left-0 top-0 z-1 max-w-none bg-pane-bg object-cover opacity-0 pointer-events-none${live ? ' opacity-100' : ''}`}
          src={liveUrl}
          style={{
            left: place.x - rect.x,
            top: place.y - rect.y,
            width: place.w,
            height: place.h,
          }}
          loop
          playsInline
          preload="auto"
          draggable={false}
        />
      )}

      {photo?.videoFile && !live && (
        <span
          className="pointer-events-none absolute left-[9px] top-[9px] z-[3] flex items-center gap-[5px] rounded-none border border-float-line bg-float-bg py-[3px] pl-1.5 pr-[7px] text-[9px] font-bold tracking-[0.09em] text-float-icon backdrop-blur-[7px] [&::before]:h-2 [&::before]:w-2 [&::before]:content-[''] [&::before]:rounded-full [&::before]:border-[1.5px] [&::before]:border-current [&::before]:shadow-[inset_0_0_0_2.5px_var(--floatBg),inset_0_0_0_3.5px_currentColor]"
          title="Live Photo — press and hold to play"
        >
          LIVE
        </span>
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

      {leaf.label && (
        <LabelView
          paneId={leaf.id}
          lab={leaf.label}
          unit={unit}
          editing={editing}
          setEditing={setEditing}
          elRef={elRef}
          onFocus={onFocus}
        />
      )}

      <div
        className={`absolute left-1/2 top-[9px] z-[3] flex -translate-x-1/2 gap-[3px] rounded-none border border-float-line bg-float-bg p-[3px] backdrop-blur-[7px] transition-opacity duration-[140ms] group-hover/pane:opacity-100${focused || !leaf.photoId ? ' opacity-100' : ' opacity-0'}`}
        onPointerDown={e => e.stopPropagation()}
      >
        <button
          className={paneBtnCls}
          title="Split top/bottom"
          onClick={(e) => {
            e.stopPropagation()
            onSplit(leaf.id, 'column')
          }}
        >
          <MorphIcon icon={SquareSplitVertical} size={14} strokeWidth={1.75} />
        </button>
        <button
          className={paneBtnCls}
          title="Split left/right"
          onClick={(e) => {
            e.stopPropagation()
            onSplit(leaf.id, 'row')
          }}
        >
          <MorphIcon icon={SquareSplitHorizontal} size={14} strokeWidth={1.75} />
        </button>
        {leaf.photoId && (
          <button
            className={`${paneBtnCls}${pickingHere ? ' bg-chip-on text-chip-on-txt' : ''}`}
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
            <MorphIcon icon={StickerIcon} size={14} strokeWidth={1.75} />
          </button>
        )}
        <button
          className={`${paneBtnCls}${editing ? ' bg-chip-on text-chip-on-txt' : ''}`}
          title="Add a text label"
          onClick={(e) => {
            e.stopPropagation()
            useStore.getState().ensureLabel(leaf.id)
            setEditing(true)
          }}
        >
          <MorphIcon icon={Type} size={14} strokeWidth={1.75} />
        </button>
      </div>

      {canClose && (
        <button
          className="group-hover/pane:opacity-100 absolute right-[9px] top-[9px] z-[3] grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg p-0 text-[15px] leading-none text-float-icon opacity-0 transition-opacity duration-[140ms] hover:border-danger hover:bg-danger hover:text-on-accent pointer-coarse:h-[30px] pointer-coarse:w-[30px]"
          title="Close this pane"
          onPointerDown={e => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose(leaf.id)
          }}
        >
          <MorphIcon icon={X} size={14} strokeWidth={1.75} />
        </button>
      )}

      {/* Drawn last so the pane border stays above its photo/stickers. */}
      <div
        aria-hidden
        className={
          `pointer-events-none absolute inset-0 z-[4] outline-1 outline-line -outline-offset-1${
            focused ? ' outline-txt' : ''
          }${dropping ? ' outline-dashed outline-txt' : ''}`
        }
        style={{ borderRadius: radius }}
      />
    </div>
  )

  if (focused)
    return paneNode

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={paneNode} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-90">
          <ContextMenu.Popup className="min-w-[180px] rounded-none border border-line-strong bg-panel p-1 shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-100 ease-out data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]">
            <ContextMenu.Item
              className="flex w-full cursor-pointer items-center whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-1.5 text-xs text-txt data-highlighted:bg-chip-hover active:bg-chip-on active:text-chip-on-txt"
              onClick={() => swapWithFocused(leaf.id, useStore.getState().focusId)}
            >
              Swap with focused pane
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export const Pane = memo(PaneImpl)
