import { useRouterState } from '@tanstack/react-router'
import { Heart } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { outputSizeFor } from '../lib/exporter'
import { useT } from '../lib/i18n'
import { leafList } from '../lib/panes'
import { activeWs, useStore } from '../store'

/**
 * The bottom-most strip: the canvas ratio and the export resolution of the
 * collage (driven by the long-edge setting and the canvas ratio). In the grid
 * overview it counts how many of the nine workspaces hold a photo. At the end:
 * a link to the GitHub repo and a made-with-love-by line.
 */
export function Footer() {
  const grid = useRouterState({ select: s => s.location.pathname === '/' })
  const t = useT()
  const longSide = useStore(s => s.longSide)
  const canvasRatio = useStore(s => activeWs(s).canvasRatio)
  const filled = useStore(s => s.workspaces.filter(w => leafList(w.root).some(l => l.photoId)).length)
  const out = outputSizeFor(longSide, canvasRatio ?? 1.5)
  // The heart sits where each locale's word order puts it: in English before
  // the byline, in zh between the verb and its object. The '{heart}' marker in
  // the translated phrase marks that spot; split around it to place the icon.
  const [lovePre, lovePost] = t('Made with {heart} by {name}', { name: 'Kevin Kwong' }).split('{heart}')

  return (
    <footer className="relative z-40 flex h-[calc(var(--statusH)+env(safe-area-inset-bottom))] flex-none items-center justify-center gap-3 whitespace-nowrap border-t border-line bg-statusbar px-1.5 pb-[env(safe-area-inset-bottom)] text-[11.5px] tabular-nums text-dim pointer-coarse:text-xs max-sm:text-xs">
      {grid
        ? (
            <span>{t('{filled} / 9 spaces', { filled })}</span>
          )
        : (
            <>
              <span>
                {t('Ratio')}
                {' '}
                {(canvasRatio ?? 1.5).toFixed(2)}
              </span>
              <span>
                {t('Output')}
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
      <a
        href="https://github.com/kvoon3/koma"
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub"
        className="transition-colors duration-[120ms] hover:text-txt"
      >
        {/* The GitHub mark: lucide no longer ships brand icons. */}
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-3">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
      </a>
      {/* The full made-with-love-by line needs ~150px and the stats already
          fill a 360px phone, so below sm only the compact label shows. */}
      <span className="hidden items-center gap-1 sm:flex">
        {lovePre.trim()}
        <MorphIcon icon={Heart} size={12} strokeWidth={1.75} aria-hidden="true" />
        {lovePost.trim()}
      </span>
      <span className="flex items-center gap-1 sm:hidden">
        {t('Made with')}
        <MorphIcon icon={Heart} size={12} strokeWidth={1.75} aria-hidden="true" />
      </span>
    </footer>
  )
}
