import type { IconInput } from 'morphicons/react'
import { Link } from '@tanstack/react-router'
import { Images, LayoutGrid, Sticker as StickerIcon } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo } from 'react'
import { formatSeen, readHubSeen } from '../lib/hubSeen'
import { useT } from '../lib/i18n'
import { leafList } from '../lib/panes'
import { photoAssetsOf, stickerAssetsOf } from '../lib/stickerLibrary'
import { useStore } from '../store'

/** The one card shape the launcher draws, one per destination. */
const cardCls = 'group flex min-w-0 cursor-pointer flex-col gap-2 border border-line bg-pane-bg p-4 text-left shadow-pop outline-0 outline-2 outline-offset-1 outline-transparent transition-[outline-color,background-color,scale] duration-(--dur-surface) ease-(--ease-out) hover:not-focus-visible:outline-line-strong focus-visible:outline-accent active:scale-[0.99] pointer-coarse:p-5'

/**
 * The hub (`/`): the app's root, three doors instead of one board. Grid making
 * is the board overview the app opened on before (now `#/grid`), photo
 * management and sticker management are the two libraries.
 *
 * It carries what a launcher is for and nothing else: each destination's icon,
 * one line about it, how much is in there, and when it was last opened (a
 * localStorage timestamp, see `lib/hubSeen`). The top bar stays above it, so
 * settings, the language, the theme and the two library doors are all one click
 * away from here, and `#/w/<id>` still opens a board directly.
 */
export function Hub() {
  const t = useT()
  const workspaces = useStore(s => s.workspaces)
  const allPhotos = useStore(s => s.photos)

  const filled = useMemo(() => workspaces.filter(w => leafList(w.root).some(l => l.photoId)).length, [workspaces])
  const photos = useMemo(() => photoAssetsOf(allPhotos).length, [allPhotos])
  const stickers = useMemo(() => stickerAssetsOf(allPhotos).length, [allPhotos])
  // Read once per mount: coming back to the hub remounts it, so the timestamps
  // recorded while you were away are the ones it shows.
  const seen = useMemo(() => readHubSeen(), [])

  const entries: { key: 'grid' | 'photos' | 'stickers', to: '/grid' | '/photos' | '/stickers', icon: IconInput, title: string, blurb: string, count: string }[] = [
    {
      key: 'grid',
      to: '/grid',
      icon: LayoutGrid,
      title: t('Grid making'),
      blurb: t('Arrange photos into collages: split, crop, filter, export.'),
      count: t('{n} of {m} workspaces filled', { n: filled, m: workspaces.length }),
    },
    {
      key: 'photos',
      to: '/photos',
      icon: Images,
      title: t('Photo management'),
      blurb: t('Every imported photo in one contact sheet, tagged and searchable.'),
      count: t('{n} photos', { n: photos }),
    },
    {
      key: 'stickers',
      to: '/stickers',
      icon: StickerIcon,
      title: t('Sticker management'),
      blurb: t('The stickers you made, in folders, with where each one is used.'),
      count: t('{n} stickers', { n: stickers }),
    },
  ]

  return (
    <main className="absolute inset-0 overflow-y-auto bg-canvas" data-hub="">
      <div className="mx-auto flex min-h-full w-full max-w-[900px] flex-col justify-center gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-txt sm:text-[22px]">{t('Welcome to koma')}</h1>
          <p className="m-0 text-[12.5px] leading-[1.6] text-dim">
            {t('Three doors: build a grid, sort your photos, keep your stickers.')}
          </p>
        </header>

        <nav className="grid gap-2.5 sm:grid-cols-3 sm:gap-3" data-hub-entries="">
          {entries.map((entry) => {
            const when = formatSeen(seen[entry.key])
            return (
              <Link
                key={entry.key}
                to={entry.to}
                className={cardCls}
                data-hub-entry={entry.key}
              >
                <span className="grid h-9 w-9 flex-none place-items-center border border-line bg-panel-2 text-txt transition-colors duration-(--dur-fast) group-hover:bg-chip-hover">
                  <MorphIcon icon={entry.icon} size={17} strokeWidth={1.5} />
                </span>
                <span className="text-[14px] font-semibold text-txt">{entry.title}</span>
                <span className="text-[11.5px] leading-[1.55] text-dim" data-hub-blurb="">{entry.blurb}</span>
                <span className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2.5 text-[10.5px] tabular-nums text-faint">
                  <span data-hub-count={entry.key}>{entry.count}</span>
                  {when && <span data-hub-seen={entry.key}>{t('Last opened {when}', { when })}</span>}
                </span>
              </Link>
            )
          })}
        </nav>
      </div>
    </main>
  )
}
