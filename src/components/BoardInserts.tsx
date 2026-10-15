import type { RefObject } from 'react'
import type { Photo } from '../lib/imageStore'
import type { Sticker } from '../lib/panes'
import { RefreshCw, RotateCcw, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useRef, useState } from 'react'
import { usePreview } from '../hooks'
import { useT } from '../lib/i18n'
import { boardStickerRect, rotateOffset, rotationCss, rotationOf, snapRotation } from '../lib/panes'
import { useStore } from '../store'

function RotationHandle({ rot, shown, onChange }: {
  rot: number
  shown: boolean
  onChange: (rot: number) => void
}) {
  const t = useT()
  const gestureRef = useRef<{ cx: number, cy: number, a0: number, r0: number } | null>(null)

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0)
      return
    e.stopPropagation()
    const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
    if (!box)
      return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    gestureRef.current = {
      cx,
      cy,
      a0: Math.atan2(e.clientY - cy, e.clientX - cx),
      r0: rot,
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g)
      return
    e.stopPropagation()
    const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx)
    onChange(snapRotation(g.r0 + (a - g.a0), e.shiftKey))
  }
  const endGesture = () => {
    gestureRef.current = null
  }

  return (
    <span
      className={`absolute -bottom-2 -left-2 grid h-[15px] w-[15px] cursor-crosshair place-items-center rounded-none border-2 border-float-bg-2 bg-accent text-on-accent opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-opacity duration-(--dur-fast) ${shown ? ' opacity-100' : ''}`}
      title={t('Drag to rotate · hold Shift to snap to 15°')}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <MorphIcon icon={RefreshCw} size={10} strokeWidth={2.5} />
    </span>
  )
}

function ResetRotationButton({ shown, onReset }: {
  shown: boolean
  onReset: () => void
}) {
  const t = useT()
  return (
    <button
      className={`absolute left-1/2 top-[calc(100%+8px)] z-[3] grid h-[22px] w-[22px] -translate-x-1/2 cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg p-0 text-float-icon backdrop-blur-[7px] transition-[opacity,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt ${
        shown ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      title={t('Reset rotation')}
      aria-label={t('Reset rotation')}
      onPointerDown={e => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onReset()
      }}
    >
      <MorphIcon icon={RotateCcw} size={13} strokeWidth={2} />
    </button>
  )
}

function BoardStickerView({
  st,
  photo,
  board,
  toCanvas,
}: {
  st: Sticker
  photo: Photo
  board: { w: number, h: number }
  toCanvas: (clientX: number, clientY: number) => { x: number, y: number }
}) {
  const preview = usePreview(photo)
  const removeSticker = useStore(s => s.removeSticker)
  const selectSticker = useStore(s => s.selectSticker)
  const rotateSticker = useStore(s => s.rotateSticker)
  const t = useT()
  const selected = useStore(s => s.stickerSel?.stickerId === st.id)
  const [hot, setHot] = useState(false)
  const leaveRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (leaveRef.current != null)
      window.clearTimeout(leaveRef.current)
  }, [])
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
  const r = boardStickerRect(board, st, aspect)
  const rot = rotationOf(st)

  const onMoveDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0)
      return
    selectSticker({ stickerId: st.id })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gestureRef.current = { mode: 'move', ocX: 0, ocY: 0, d0: 0, s0: st.s }
  }
  const onMoveMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'move')
      return
    e.stopPropagation()
    const p = toCanvas(e.clientX, e.clientY)
    useStore.getState().moveSticker(st.id, p.x / board.w, p.y / board.h)
  }

  const onResizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0)
      return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const corner = toCanvas(e.clientX, e.clientY)
    const o = rotateOffset(-r.w / 2, -r.h / 2, rot)
    const ocX = r.x + r.w / 2 + o.x
    const ocY = r.y + r.h / 2 + o.y
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
    const s = useStore.getState()
    s.moveSticker(st.id, ((g.ocX + p.x) / 2) / board.w, ((g.ocY + p.y) / 2) / board.h)
    s.scaleSticker(st.id, g.s0 * (dist / g.d0))
  }

  const endGesture = () => {
    gestureRef.current = null
  }

  return (
    <div
      className="group/sticker absolute z-[5] cursor-grab touch-none active:cursor-grabbing"
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, transform: rotationCss(st) }}
      title={photo.name}
      onPointerDown={onMoveDown}
      onPointerMove={onMoveMove}
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
    >
      <img src={preview.url} alt="" draggable={false} className="pointer-events-none block h-full w-full max-w-none" />
      <span
        className={`group-hover/sticker:opacity-100 absolute -right-2 -bottom-2 h-[15px] w-[15px] cursor-nwse-resize rounded-none border-2 border-float-bg-2 bg-accent opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-opacity duration-(--dur-fast) ${hot || selected ? ' opacity-100' : ''}`}
        title={t('Drag to resize')}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
      <RotationHandle
        rot={rot}
        shown={hot || selected}
        onChange={value => rotateSticker(st.id, value)}
      />
      <ResetRotationButton
        shown={rot !== 0 && (hot || selected)}
        onReset={() => rotateSticker(st.id, 0)}
      />
      <button
        className={`group-hover/sticker:opacity-100 absolute -top-[9px] -right-[9px] grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-none border border-float-bg-2 bg-danger p-0 text-on-accent opacity-0 transition-[opacity,scale] duration-(--dur-fast) active:scale-[0.97] ${hot || selected ? ' opacity-100' : ''}`}
        title={t('Remove sticker')}
        onPointerDown={e => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          removeSticker(st.id)
        }}
      >
        <MorphIcon icon={X} size={12} strokeWidth={2} />
      </button>
    </div>
  )
}

/**
 * Collage-level insert layer: stickers float over the whole board and are not
 * clipped by pane overflow. Labels stay pane-owned for now but can follow the
 * same layer in a later pass.
 */
export function BoardInserts({
  stickers,
  photoById,
  board,
  stageRef,
}: {
  stickers: Sticker[]
  photoById: Map<string, Photo>
  board: { w: number, h: number }
  stageRef: RefObject<HTMLElement | null>
}) {
  const toCanvas = (clientX: number, clientY: number) => {
    const box = stageRef.current?.getBoundingClientRect()
    if (!box)
      return { x: 0, y: 0 }
    return { x: clientX - box.left, y: clientY - box.top }
  }

  if (!stickers.length)
    return null

  return (
    <>
      {stickers.map((st) => {
        const photo = photoById.get(st.photoId)
        if (!photo)
          return null
        return (
          <BoardStickerView
            key={st.id}
            st={st}
            photo={photo}
            board={board}
            toCanvas={toCanvas}
          />
        )
      })}
    </>
  )
}
