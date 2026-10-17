import { useCallback, useRef, useState } from 'react'
import {
  assistDeg,
  degToRad,
  detentTicks,
  dialDegAt,
  dialPercent,
  FINE_STEP_DEG,
  formatDeg,
  HARD_STEP_DEG,
  nudgeDeg,
  radToDeg,
  settleDeg,
  snapFine,
  SOFT_STEP_DEG,
  wrapDeg,
} from '../../lib/detent'
import { useT } from '../../lib/i18n'

/**
 * The app's one rotation control: a stepless dial, with detents felt as
 * magnetism, for anything that turns. Every rotation UI adopts it (a pane's
 * photo now; board stickers and labels when they migrate), so it takes a value
 * and reports a value and knows nothing about the store, the pane tree or what
 * is being turned.
 *
 * The dial is a full turn, -180° … 180°:
 * - a drag is continuous: the knob tracks the pointer and the value stored is
 *   the pointer's exact angle (23.7° stays 23.7°), not a lattice point;
 * - the ticks are a feel, not a grid (`assistDeg`): inside ±4° of a 15° tick the
 *   angle leans toward it (a suggestion), inside ±10° of a 90° tick it leans
 *   harder (upright and sideways hold), and at the band's edge the lean is gone,
 *   so a continuing drag always walks past the tick;
 * - letting go settles (`settleDeg`): within 2.5° of a hard tick the angle folds
 *   onto it exactly; anywhere else it keeps the angle the hand stopped at;
 * - the reading is the zero button (tap it, or double-click the track, or press
 *   Home / 0), and the arrow keys walk the dial by a tick (Shift = 90°,
 *   Alt = 1°), so the keyboard stays quantized;
 * - the `1°` toggle keeps a quantized drag (whole degrees, no magnetism) for
 *   anyone who wants an integer angle; holding Alt does the same mid-drag.
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
  /** The quantized path: whole degrees instead of the stepless drag. Alt engages it mid-drag. */
  const [fine, setFine] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<number | null>(null)
  /**
   * The last angle a drag emitted: release settles from it, not from the prop,
   * which may still be a render behind the final pointermove.
   */
  const lastDegRef = useRef<number | null>(null)
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
    lastDegRef.current = w
    if (w !== deg)
      onChange(degToRad(w))
  }, [deg, onChange])

  /** Pointer x → the angle it reads at (stepless, with the detents' lean). */
  const angleAt = useCallback((clientX: number, alt: boolean) => {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0)
      return null
    const ratio = (clientX - box.left) / box.width
    leftHalfRef.current = ratio < 0.5
    const raw = dialDegAt(ratio)
    return alt || fine ? snapFine(raw) : assistDeg(raw)
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

  /** Release, and let a hard tick take the angle if the hand stopped on it. */
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== e.pointerId)
      return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    const last = lastDegRef.current
    if (last != null) {
      // Settle even when the prop has not caught up with the final move: the
      // capture must land, and a no-op value is dropped by the store.
      const settled = settleDeg(last)
      if (settled !== last) {
        lastDegRef.current = settled
        onChange(degToRad(settled))
      }
    }
  }

  /** The gesture was taken away (e.g. the OS scrolled): keep the angle, no settle. */
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
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
        aria-valuenow={Math.round(deg * 10) / 10}
        aria-valuetext={formatDeg(deg)}
        aria-orientation="horizontal"
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        data-rotation-dial=""
        className={`${dialBaseCls} ${disabled ? ' cursor-default opacity-35' : ' cursor-ew-resize'} focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2`}
        style={{ height: TRACK_H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
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
        {/* The knob: one square grip on the accent, riding the angle exactly. */}
        <span
          aria-hidden
          className="absolute top-1/2 z-1 block h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 bg-accent"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}
