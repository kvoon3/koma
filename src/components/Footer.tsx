import { useRouterState } from '@tanstack/react-router'
import { Heart } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { siGithub, siVite } from 'simple-icons'
import { outputSizeFor } from '../lib/exporter'
import { useT } from '../lib/i18n'
import { isGridPath } from '../lib/routes'
import { activeWs, useStore } from '../store'

/**
 * Status strip: canvas ratio / export size (editor only), then the byline
 * (Vite + love + Kevin Kwong) and GitHub. Lives in the Tools drawer sheet so
 * it rides with the dock instead of sitting under it.
 */
export function Footer({ className }: { className?: string } = {}) {
  const grid = useRouterState({ select: s => isGridPath(s.location.pathname) })
  const t = useT()
  const longSide = useStore(s => s.longSide)
  const canvasRatio = useStore(s => activeWs(s).canvasRatio)
  const out = outputSizeFor(longSide, canvasRatio ?? 1.5)
  // Both marks sit mid-phrase, where each locale's word order puts them: the
  // Vite mark in front of the word Vite, the heart in front of the byline. The
  // '{vite}' / '{heart}' markers in the translated phrase mark those spots.
  const [beforeVite, afterVite] = t('Made with {vite} Vite and {heart} by {name}', { name: 'Kevin Kwong' }).split('{vite}')
  const [beforeHeart, afterHeart] = afterVite.split('{heart}')

  return (
    <footer
      className={`flex h-[calc(var(--statusH)+env(safe-area-inset-bottom))] flex-none items-center justify-center gap-3 whitespace-nowrap border-t border-line bg-statusbar px-1.5 pb-[env(safe-area-inset-bottom)] text-[11.5px] tabular-nums text-dim pointer-coarse:text-xs max-sm:text-xs ${className ?? ''}`}
    >
      {!grid && (
        <span className="hidden items-center gap-3 sm:flex">
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
        </span>
      )}
      <span className="flex items-center gap-1">
        {beforeVite.trim()}
        <BrandMark path={siVite.path} />
        {beforeHeart.trim()}
        <MorphIcon icon={Heart} size={12} strokeWidth={1.75} aria-hidden="true" />
        {afterHeart.trim()}
      </span>
      <a
        href="https://github.com/kvoon3/koma"
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub"
        className="transition-colors duration-(--dur-fast) hover:text-txt"
      >
        <BrandMark path={siGithub.path} />
      </a>
    </footer>
  )
}

/**
 * A filled brand mark, at the footer's icon size. Lucide ships no brand icons
 * and the palette is off limits to them, so both the Vite mark before the word
 * Vite and the GitHub link's mark come from Simple Icons on `currentColor`.
 */
function BrandMark({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-3 flex-none">
      <path d={path} />
    </svg>
  )
}
