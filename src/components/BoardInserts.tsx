import type { RefObject } from 'react'
import type { Photo } from '../lib/imageStore'
import type { PaneLabel, Sticker } from '../lib/panes'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useRef, useState } from 'react'
import { usePreview } from '../hooks'
import { viewScaleAt } from '../lib/canvasView'
import { useT } from '../lib/i18n'
import { boardStickerRect, rotateOffset, rotationCss, rotationOf } from '../lib/panes'
import { useStore } from '../store'
import { BoardLabel, ResetRotationButton, RotationHandle } from './BoardLabel'

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
      data-board-sticker={photo.id}
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
 * Collage-level insert layer: stickers (image inserts) and text labels float
 * over the whole board, unclipped by pane overflow, in canvas-normalized coords.
 */
export function BoardInserts({
  stickers,
  labels,
  unit,
  photoById,
  board,
  stageRef,
}: {
  stickers: Sticker[]
  labels: PaneLabel[]
  unit: number
  photoById: Map<string, Photo>
  board: { w: number, h: number }
  stageRef: RefObject<HTMLElement | null>
}) {
  const toCanvas = (clientX: number, clientY: number) => {
    const box = stageRef.current?.getBoundingClientRect()
    if (!box)
      return { x: 0, y: 0 }
    // Screen pixels to canvas pixels: the canvas may carry the view zoom.
    const s = viewScaleAt(stageRef.current)
    return { x: (clientX - box.left) / s, y: (clientY - box.top) / s }
  }

  return (
    <>
      {stickers.map((st) => {
        const photo = photoById.get(st.photoId)
        if (!photo)
          return null
        return <BoardStickerView key={st.id} st={st} photo={photo} board={board} toCanvas={toCanvas} />
      })}
      {labels.map(lab => <BoardLabel key={lab.id} lab={lab} unit={unit} boardRef={stageRef} />)}
    </>
  )
}
