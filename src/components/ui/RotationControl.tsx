import { useCallback, useRef, useState } from 'react'
import {
  degToRad,
  detentTicks,
  dialDegAt,
  dialPercent,
  FINE_STEP_DEG,
  formatDeg,
  HARD_STEP_DEG,
  nudgeDeg,
  radToDeg,
  snapDetent,
  snapFine,
  SOFT_STEP_DEG,
  wrapDeg,
} from '../../lib/detent'
import { useT } from '../../lib/i18n'

/**
 * The app's one rotation control: a detent dial, snapping on click-through
 * ticks, for anything that turns. Every rotation UI adopts it (a pane's photo
 * now; board stickers and labels when they migrate), so it takes a value and
 * reports a value and knows nothing about the store, the pane tree or what is
 * being turned.
 *
 * The dial is a full turn, -180° … 180°:
 * - a detent drag clicks through the 15° ticks (`SOFT_STEP_DEG`) and holds the
 *   90° ones (`HARD_STEP_DEG`) across a wider magnetic band, so upright and
 *   sideways are easy to land on;
 * - holding Alt (or the `1°` toggle) switches to the fine path, 1° steps between
 *   the ticks;
 * - the reading is the zero button (tap it, or double-click the track, or press
 *   Home / 0), and the arrow keys walk the dial by a tick (Shift = 90°,
 *   Alt = 1°).
 *
 * Values are radians, wrapped to (-π, π] like every stored angle in the app.
 */

export interface RotationControlProps {
  /** Angle in radians; wrapped by the caller (`wrapAngle`, lib/panes). */
  value: number
  /** The wrapped angle the dial moved to, in radians. Streams while dragging. */
  onChange: (rad: number) => void
  /** Accessible name of the dial, e.g. "Rotation". */
  label: string
  disabled?: boolean
  className?: string
}

/** Track thickness plus tick heights, in px: the dial's own small metrics. */
const TRACK_H = 34
const TICK_SOFT = 7
const TICK_HARD = 12

const dialBaseCls = 'relative w-full touch-none select-none'
const btnCls = 'box-border flex h-[22px] cursor-pointer items-center justify-center gap-1 rounded-none border border-line-strong bg-panel-2 px-1.5 text-[11px] text-dim hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:text-accent disabled:cursor-default disabled:opacity-35'

export function RotationControl({ value, onChange, label, disabled = false, className = '' }: RotationControlProps) {
  const t = useT()
  /** The fine path: 1° steps instead of the 15° detents. Alt engages it mid-drag. */
  const [fine, setFine] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<number | null>(null)
  /**
   * Which end of the track the pointer is on. A half turn folds onto one
   * orientation (+180), so the knob has to remember which end of the dial the
   * hand is at instead of snapping across the whole track.
   */
  const leftHalfRef = useRef(false)

  const deg = wrapDeg(radToDeg(value))
  const ticks = detentTicks()

  const emit = useCallback((nextDeg: number) => {
    const w = wrapDeg(nextDeg)
    if (w !== deg)
      onChange(degToRad(w))
  }, [deg, onChange])

  /** Pointer x → the angle the dial lands on (detent or fine, per `fine`/Alt). */
  const angleAt = useCallback((clientX: number, alt: boolean) => {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0)
      return null
    const ratio = (clientX - box.left) / box.width
    leftHalfRef.current = ratio < 0.5
    const raw = dialDegAt(ratio)
    return alt || fine ? snapFine(raw) : snapDetent(raw)
  }, [fine])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0)
      return
    const next = angleAt(e.clientX, e.altKey)
    if (next == null)
      return
    dragRef.current = e.pointerId
    e.currentTarget.setPointerCapture(e.pointerId)
    emit(next)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || dragRef.current !== e.pointerId)
      return
    const next = angleAt(e.clientX, e.altKey)
    if (next != null)
      emit(next)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== e.pointerId)
      return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled)
      return
    const step = e.altKey ? FINE_STEP_DEG : e.shiftKey ? HARD_STEP_DEG : SOFT_STEP_DEG
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      emit(nudgeDeg(deg, step, 1))
    }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      emit(nudgeDeg(deg, step, -1))
    }
    else if (e.key === 'Home' || e.key === '0') {
      e.preventDefault()
      onChange(0)
    }
  }

  // A half turn has one seam: the knob parks at the end the hand is on.
  const pct = deg === 180 && leftHalfRef.current ? 0 : dialPercent(deg)

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-dim">{label}</span>
        <div className="flex items-center gap-1">
          {/* The reading is the zero button: tap the number to go back upright. */}
          <button
            type="button"
            className={`${btnCls} min-w-11 justify-end border-transparent bg-transparent pr-0 text-accent tabular-nums`}
            title={t('Reset rotation')}
            aria-label={t('Reset rotation')}
            disabled={disabled || deg === 0}
            onClick={() => onChange(0)}
          >
            {formatDeg(deg)}
          </button>
          <button
            type="button"
            className={btnCls}
            aria-pressed={fine}
            title={t('Fine rotation, 1° steps')}
            onClick={() => setFine(f => !f)}
          >
            1°
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-valuenow={deg}
        aria-valuetext={formatDeg(deg)}
        aria-orientation="horizontal"
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        data-rotation-dial=""
        className={`${dialBaseCls} ${disabled ? ' cursor-default opacity-35' : ' cursor-ew-resize'} focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2`}
        style={{ height: TRACK_H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => !disabled && onChange(0)}
        onKeyDown={onKeyDown}
      >
        {/* The hairline the ticks stand on. */}
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-line" />
        {ticks.map(tick => (
          <span
            key={tick.deg}
            aria-hidden
            data-tick={tick.hard ? 'hard' : 'soft'}
            className={`absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2 ${tick.hard ? ' bg-accent' : ' bg-dim'}`}
            style={{ left: `${dialPercent(tick.deg)}%`, height: tick.hard ? TICK_HARD : TICK_SOFT }}
          />
        ))}
        {/* The knob: one square grip on the accent, riding the ticks. */}
        <span
          aria-hidden
          className="absolute top-1/2 z-1 block h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 bg-accent"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}
