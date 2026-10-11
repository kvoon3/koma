import { outputSizeFor } from '../lib/exporter'
import { leafList } from '../lib/panes'
import { activeWs, useStore } from '../store'

/**
 * The bottom-most strip: the canvas ratio and the export resolution of the
 * collage (driven by the long-edge setting and the canvas ratio). In the grid
 * overview it counts how many of the nine workspaces hold a photo.
 */
export function Footer() {
  const view = useStore(s => s.view)
  const longSide = useStore(s => s.longSide)
  const canvasRatio = useStore(s => activeWs(s).canvasRatio)
  const filled = useStore(s => s.workspaces.filter(w => leafList(w.root).some(l => l.photoId)).length)
  const out = outputSizeFor(longSide, canvasRatio ?? 1.5)

  return (
    <footer className="relative z-40 flex h-[calc(var(--statusH)+env(safe-area-inset-bottom))] flex-none items-center justify-center gap-3 border-t border-line bg-statusbar px-1.5 pb-[env(safe-area-inset-bottom)] text-[11.5px] tabular-nums text-dim pointer-coarse:text-xs max-sm:text-xs">
      {view === 'grid'
        ? (
            <span>
              {filled}
              {' '}
              / 9 spaces
            </span>
          )
        : (
            <>
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
            </>
          )}
    </footer>
  )
}
