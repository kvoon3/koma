import NumberFlow from '@number-flow/react'
import { viewPercent } from '../lib/canvasView'
import { useT } from '../lib/i18n'

/**
 * The view-zoom indicator: bold text that fades in once the canvas view is off
 * fit and puts it back on click. No background or border: the digits are the
 * affordance, the same weight as the float row beside it. Fading out takes the
 * chip past the unmount instead of the unmount cutting the fade, so the click
 * to fit rolls the digits home to 100% before the chip disappears.
 */
export function ViewZoomChip({ scale, onFit, className = '' }: {
  /** The live view scale; the chip renders nothing at fit. */
  scale: number
  onFit: () => void
  /** Placement, written by the stage that owns the margin. */
  className?: string
}) {
  const t = useT()
  const offFit = Math.abs(scale - 1) > 1e-3
  const pct = viewPercent(scale)
  const label = t('Canvas at {n}% · click to fit', { n: pct })
  // aria-hidden at fit: the visible readout is gone and `tabular-nums` ghosts
  // must not sit in the a11y tree twice.
  return (
    <button
      type="button"
      data-view-zoom-chip=""
      aria-hidden={offFit ? undefined : true}
      className={`pointer-events-none absolute grid h-[30px] min-w-[46px] cursor-pointer place-items-center px-1.5 text-[11px] font-bold tabular-nums text-float-icon transition-[opacity,scale] duration-(--dur-fast) active:scale-[0.97] hover:text-txt focus-visible:outline-1 focus-visible:outline-accent focus-visible:pointer-events-auto pointer-coarse:h-[38px] ${offFit ? 'pointer-events-auto opacity-100 scale-100' : 'opacity-0 scale-[0.96]'} ${className}`}
      title={label}
      aria-label={offFit ? label : undefined}
      onClick={onFit}
    >
      {/* Rolls per gesture notch; the suffix lives inside so the grid keeps
          one item and the sign rides the digits. */}
      <NumberFlow value={pct} format={{ useGrouping: false }} suffix="%" willChange />
    </button>
  )
}
