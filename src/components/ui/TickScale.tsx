import type { CSSProperties } from 'react'

/**
 * The app's tick scale: a hairline track, the marks that stand on it, and the bar
 * that rides it.
 *
 * Both scales in the app draw through it: the rotate dial
 * (`ui/RotationControl`, a horizontal full turn) and the canvas size rail
 * (`CanvasResizeRail`, a vertical range). Their marks, their hierarchy and their
 * bar are one design rather than two that drift apart.
 *
 * It paints only: the caller owns the value, the pointer mapping and the
 * accessibility (the `role="slider"` sits on the caller's own element), so this
 * stays a dumb, predictable layer.
 */

/** A mark across the track: the short one, and the longer strong one. */
export const SCALE_MARK_SOFT = 7
export const SCALE_MARK_HARD = 11
/**
 * The bar: long enough across the track to out-read the strongest mark, thin
 * along it, so it reads as a playhead rather than as one more tick.
 */
export const SCALE_BAR_LONG = 16
export const SCALE_BAR_THICK = 3

export interface ScaleMark {
  /** Position along the travel: 0 at the start (left / bottom), 1 at the end. */
  at: number
  /** Length across the track, in px. */
  length: number
  /** A strong mark: the dial's 90° stops, the rail's fit and halves. */
  strong?: boolean
  /** 0..1: how near the bar is. Brightens the mark, and grows it by `growth`. */
  near?: number
}

export interface TickScaleProps {
  ticks: readonly ScaleMark[]
  /** The bar's position along the travel, 0..1 (outside it is the ends' give). */
  value: number
  orientation?: 'horizontal' | 'vertical'
  /** Px the bar's centre keeps from either end, where it cannot overhang. */
  inset?: number
  /**
   * `panel` draws the scale for a surface it sits in (the rotate dial), where
   * the accent is safe. `float` draws it as chrome over a photo, where an accent
   * hairline is near-black in the light theme and disappears into a dark photo:
   * length and opacity carry the hierarchy there, every mark and the spine get a
   * glass underlay a pixel wider, and the bar gets a 1px glass ring.
   */
  tone?: 'panel' | 'float'
  /** How much a near mark grows (0 = fixed marks, which is the rotate dial). */
  growth?: number
  /** The bar's own scale: the rail presses its bar up while dragging. */
  barScale?: number
  /**
   * `settle` eases the bar to a value that changed from elsewhere (a keypress,
   * an undo); `still` moves it raw, which is what a drag needs so the bar never
   * lags the pointer. The dial always drags, so it stays `still`.
   */
  barMotion?: 'still' | 'settle'
}

/**
 * The floating scale's underlay: a glass copy of the mark, half a pixel proud on
 * each side, so a hairline keeps a clean edge over a photo in either theme. A
 * blurred drop shadow would do the same job and look muddy doing it; a hard
 * underlay stays a hairline (a full pixel a side turns the mark into a boxed
 * dash at 2x).
 */
const FLOAT_UNDERLAY = 'var(--floatBg)'

/**
 * Paints a scale from the caller's marks and value: the rotate dial's
 * horizontal full turn and the canvas size rail's vertical range both draw
 * through it. The caller keeps the pointer mapping and the slider role.
 */
export function TickScale({
  ticks,
  value,
  orientation = 'vertical',
  inset = 0,
  tone = 'panel',
  growth = 0,
  barScale = 1,
  barMotion = 'still',
}: TickScaleProps) {
  const axis = orientation === 'vertical'
  const floating = tone === 'float'
  /** A point on the track: the travel axis it moves along, the other one centred. */
  const place = (at: number): CSSProperties =>
    axis ? { top: `${at * 100}%`, left: '50%' } : { left: `${at * 100}%`, top: '50%' }
  /** A mark's box: `across` across the track, `along` along it. */
  const box = (across: number, along: number): CSSProperties =>
    axis ? { width: across, height: along } : { height: across, width: along }
  /** How strongly a mark shows at the bar's distance, and how far it grows. */
  const weight = (mark: ScaleMark) =>
    (mark.strong ? 0.9 : 0.5) + (mark.near ?? 0) * (mark.strong ? 0.1 : 0.42)
  const grow = (mark: ScaleMark) =>
    mark.near && growth > 0 && !mark.strong ? `${1 + mark.near * growth} 1` : undefined

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {/* The travel: the bar's centre runs from `inset` to the far `inset`, and
          the marks share that line so a mark and the bar always agree. */}
      <span
        data-scale-travel=""
        className="absolute"
        style={axis ? { left: 0, right: 0, top: inset, bottom: inset } : { top: 0, bottom: 0, left: inset, right: inset }}
      >
        {/* On a floating scale everything is drawn twice: a glass underlay a
            pixel wider, then the mark itself. The underlay is what survives a
            dark photo, and it is crisp where a blur would be muddy. */}
        {floating && (
          <span data-scale-rim="" aria-hidden className="absolute inset-0">
            <span
              className={`absolute ${axis
                ? 'bottom-0 left-1/2 top-0 w-[2px] -translate-x-1/2'
                : 'left-0 right-0 top-1/2 h-[2px] -translate-y-1/2'}`}
              style={{ background: FLOAT_UNDERLAY, opacity: 0.5 }}
            />
            {ticks.map(mark => (
              <span
                key={mark.at}
                className="absolute"
                style={{
                  ...place(mark.at),
                  ...box(mark.length + 1, 2),
                  translate: '-50% -50%',
                  background: FLOAT_UNDERLAY,
                  opacity: weight(mark) * 0.85,
                  ...(grow(mark) ? { scale: grow(mark) } : {}),
                }}
              />
            ))}
          </span>
        )}

        <span data-scale-marks="" className="absolute inset-0">
          {/* The hairline the marks stand on: the spine of the scale, and on a
              floating one the dimmest thing in it, since it is measured, not
              read. */}
          <span
            data-scale-track=""
            className={`absolute ${floating ? 'bg-float-icon opacity-70' : 'bg-line'} ${
              axis
                ? 'bottom-0 left-1/2 top-0 w-px -translate-x-1/2'
                : 'left-0 right-0 top-1/2 h-px -translate-y-1/2'}`}
          />
          {ticks.map(mark => (
            <span
              key={mark.at}
              data-tick={mark.strong ? 'hard' : 'soft'}
              className={`absolute transition-[opacity,scale] duration-(--dur-fast) ease-(--ease-out) motion-reduce:transition-none ${
                floating ? 'bg-float-icon' : mark.strong ? 'bg-accent' : 'bg-dim'}`}
              style={{
                ...place(mark.at),
                ...box(mark.length, 1),
                translate: '-50% -50%',
                // The strong marks hold their length: they are the landmarks.
                ...(grow(mark) ? { scale: grow(mark) } : {}),
                ...(floating ? { opacity: weight(mark) } : {}),
              }}
            />
          ))}
        </span>

        {/* The bar: the one thing that moves, and the only thing the accent
            wears on a floating scale. */}
        <span
          data-scale-bar=""
          className={`absolute rounded-[1px] bg-accent ${floating ? 'shadow-[0_0_0_1px_var(--floatBg)]' : ''} ${
            barMotion === 'settle'
              ? 'transition-[top,scale] duration-(--dur-surface) ease-(--ease-out) motion-reduce:transition-none'
              : ''}`}
          style={{
            ...place(value),
            ...box(SCALE_BAR_LONG, SCALE_BAR_THICK),
            translate: '-50% -50%',
            scale: String(barScale),
          }}
        />
      </span>
    </span>
  )
}
