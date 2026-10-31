import NumberFlow from '@number-flow/react'
import { isOffFit, viewPercent } from '../lib/canvasView'
import { useT } from '../lib/i18n'

/**
 * The view-zoom indicator: a small chip that appears once the canvas view is
 * off fit and puts it back on click. The app's floating-chrome idiom (a
 * float-bg scrim with a blur, chip-hover under the pointer), the same weight as
 * the back / undo buttons it sits under, and only while it has something to
 * say, so a fitted canvas keeps the stage clean.
 */
export function ViewZoomChip({ scale, onFit, className = '' }: {
  /** The live view scale; the chip renders nothing at fit. */
  scale: number
  onFit: () => void
  /** Placement, written by the stage that owns the margin. */
  className?: string
}) {
  const t = useT()
  if (!isOffFit(scale))
    return null
  const pct = viewPercent(scale)
  const label = t('Canvas at {n}% · click to fit', { n: pct })
  return (
    <button
      type="button"
      data-view-zoom-chip=""
      className={`grid h-[30px] min-w-[46px] cursor-pointer place-items-center border border-float-line bg-float-bg px-1.5 text-[11px] font-semibold tabular-nums text-float-icon backdrop-blur-[7px] transition-[background-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent pointer-coarse:h-[38px] ${className}`}
      title={label}
      aria-label={label}
      onClick={onFit}
    >
      {/* Rolls per gesture notch; the suffix lives inside so the grid keeps
          one item and the sign rides the digits. */}
      <NumberFlow value={pct} format={{ useGrouping: false }} suffix="%" willChange />
    </button>
  )
}
