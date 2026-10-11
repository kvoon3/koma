import { outputSizeFor } from '../lib/exporter'
import { useStore } from '../store'

/**
 * The bottom-most strip: the canvas ratio and the export resolution of the
 * collage (driven by the long-edge setting and the canvas ratio).
 */
export function Footer() {
  const longSide = useStore(s => s.longSide)
  const canvasRatio = useStore(s => s.canvasRatio)
  const out = outputSizeFor(longSide, canvasRatio ?? 1.5)

  return (
    <footer className="relative z-40 flex h-[calc(var(--statusH)+env(safe-area-inset-bottom))] flex-none items-center justify-center gap-3 border-t border-line bg-statusbar px-1.5 pb-[env(safe-area-inset-bottom)] text-[11.5px] tabular-nums text-dim pointer-coarse:text-xs max-sm:text-xs">
      <span>
        Ratio
        {' '}
        {(canvasRatio ?? 1.5).toFixed(2)}
      </span>
      <span>
        Output
        {' '}
        {out.W}
        {' '}
        ×
        {' '}
        {out.H}
        {' '}
        px
      </span>
    </footer>
  )
}
