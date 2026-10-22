import type { Photo } from '../../lib/imageStore'
import type { LibrarySectionProps } from '../../lib/library'
import { Dialog } from '@base-ui/react/dialog'
import { Check, Music, Trash2, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { useAssetUses, useInView, usePreview, useThumb } from '../../hooks'
import { useT } from '../../lib/i18n'
import { matchesQuery, normalizeQuery } from '../../lib/library'
import { PROVIDER_COLORS, PROVIDER_LABELS } from '../../lib/musicCard'
import { say } from '../../lib/toast'
import { useStore } from '../../store'
import { ConfirmDialog } from '../ConfirmDialog'
import { Button } from '../ui/button'
import { buttonBase, buttonVariants } from '../ui/buttonStyles'
import { Tip } from '../ui/tip'

/**
 * The music half of the library: cards the music tool rendered, each a square
 * image asset that can fill a pane like a photo. There are no tags or folders;
 * the only grouping is the one the page's type chips give every kind.
 */
export function MusicLibrarySection({ items, query }: LibrarySectionProps) {
  const t = useT()
  const uses = useAssetUses()
  const [openId, setOpenId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const q = normalizeQuery(query)
  const shown = items.filter(p => matchesQuery(p, q))
  const openPhoto = openId ? items.find(p => p.id === openId) ?? null : null

  return (
    <section className="flex flex-col [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line" data-library-section="music">
      <div className="flex items-baseline gap-2 px-3 pb-1.5 pt-3 sm:px-4 sm:pt-4">
        <h2 className="m-0 text-[13.5px] font-semibold text-txt">{t('Music')}</h2>
        <span className="text-[11.5px] tabular-nums text-dim" data-library-section-count="">{items.length}</span>
      </div>

      <div className="px-3 pb-4 sm:px-4">
        {shown.length > 0
          ? (
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5"
                data-music-grid=""
              >
                {shown.map(p => (
                  <MusicAssetCard
                    key={p.id}
                    photo={p}
                    uses={uses.get(p.id) ?? 0}
                    onOpen={() => setOpenId(p.id)}
                    onDelete={() => setDeleting(p.id)}
                  />
                ))}
              </div>
            )
          : <MusicEmptyState empty={items.length === 0} />}
      </div>

      <MusicDetail
        photo={openPhoto}
        uses={openPhoto ? uses.get(openPhoto.id) ?? 0 : 0}
        onRequestDelete={(id) => {
          setDeleting(id)
          setOpenId(null)
        }}
        onClose={() => setOpenId(null)}
      />

      <MusicDeleteDialog photoId={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

/**
 * One card on the page: the rendered square whole (object-contain, so none of
 * the card's type is cropped), its provider and how many places draw it.
 */
function MusicAssetCard({
  photo,
  uses,
  onOpen,
  onDelete,
}: {
  photo: Photo
  uses: number
  onOpen: () => void
  onDelete: () => void
}) {
  const t = useT()
  const [ref, seen] = useInView<HTMLDivElement>('300px')
  const url = useThumb(photo, seen)
  const used = uses > 0
  const provider = photo.music?.provider ?? 'spotify'

  return (
    <article
      ref={ref}
      className="group flex min-w-0 flex-col border border-line bg-panel"
      data-music-card=""
      data-music-id={photo.id}
      data-music-provider={provider}
      data-music-usage={used ? 'used' : 'unused'}
    >
      <button
        type="button"
        className="relative block aspect-square w-full cursor-pointer overflow-hidden border-0 bg-thumb-bg p-0 outline-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        aria-label={t('Open {name}', { name: photo.name })}
        data-music-open=""
        onClick={onOpen}
      >
        {url
          ? <img src={url} alt={photo.name} className="photo-in block h-full w-full object-contain" draggable={false} />
          : <span className="block h-full w-full" />}

        <span
          className="absolute left-1.5 top-1.5 flex items-center gap-1 border border-line-strong bg-badge-bg px-1.5 py-px text-[9.5px] font-semibold text-txt backdrop-blur-[3px]"
          data-music-provider-badge=""
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: PROVIDER_COLORS[provider] }} />
          {PROVIDER_LABELS[provider]}
        </span>

        <span
          className={`absolute right-1.5 top-1.5 flex items-center gap-1 border px-1.5 py-px text-[9.5px] font-semibold tabular-nums backdrop-blur-[3px] ${used ? 'border-transparent bg-accent text-on-accent' : 'border-line-strong bg-badge-bg text-dim'}`}
          data-music-usage-badge=""
          title={used ? t('Used in {n} places on the board', { n: uses }) : t('Not placed on the board')}
        >
          {used && <MorphIcon icon={Check} size={9} strokeWidth={2.5} />}
          {used ? t('Used {n}', { n: uses }) : t('Unused')}
        </span>
      </button>

      <div className="flex items-center gap-1 border-t border-line py-1 pl-2 pr-1">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-txt" title={photo.name} data-music-name="">
          {photo.name}
        </span>
        <Tip
          label={t('Delete music card')}
          trigger={(
            <button
              type="button"
              className="grid h-[22px] w-[22px] flex-none cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-faint transition-colors duration-(--dur-fast) hover:not-disabled:bg-chip-hover hover:not-disabled:text-danger"
              aria-label={t('Delete music card')}
              data-music-delete-button=""
              onClick={onDelete}
            >
              <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
            </button>
          )}
        />
      </div>
    </article>
  )
}

/** The card large enough to read, what it is, where it came from, and delete. */
function MusicDetail({ photo, uses, onRequestDelete, onClose }: {
  photo: Photo | null
  uses: number
  onRequestDelete: (id: string) => void
  onClose: () => void
}) {
  const t = useT()
  const preview = usePreview(photo)
  const music = photo?.music
  const provider = music?.provider ?? 'spotify'
  const title = music?.title || photo?.name || ''
  const linkLabel = t('Open on {provider}', { provider: PROVIDER_LABELS[provider] })

  return (
    <Dialog.Root
      open={photo != null}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed z-(--z-modal) inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup
          data-music-detail=""
          className="fixed z-(--z-modal) left-1/2 top-1/2 flex max-h-[min(90dvh,760px)] w-[min(520px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]"
        >
          <header className="flex flex-none items-center justify-between gap-2.5 border-b border-line py-2 pl-4 pr-2">
            <Dialog.Title className="m-0 min-w-0 flex-1 truncate text-[13.5px] font-semibold" data-music-detail-title="">
              {title}
            </Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="mx-auto flex aspect-square w-full max-w-[320px] items-center justify-center overflow-hidden border border-line bg-panel-2">
              {preview
                ? <img src={preview.url} alt={photo?.name ?? ''} className="photo-in block h-full w-full object-contain" draggable={false} data-music-detail-image="" />
                : <span className="block h-full w-full" />}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-txt" data-music-detail-name="">{title}</span>
              <span className="text-[11.5px] text-dim" data-music-detail-artist="">{music?.artist || t('No artist')}</span>
              <span className="text-[11px] text-faint" data-music-detail-usage="">
                {uses > 0 ? t('Used in {n} places on the board', { n: uses }) : t('Not placed on the board')}
              </span>
            </div>
          </div>

          <div className="flex flex-none items-center justify-between gap-2 border-t border-line px-3 py-2.5">
            <Button
              variant="danger"
              data-music-detail-delete=""
              onClick={() => {
                if (photo)
                  onRequestDelete(photo.id)
              }}
            >
              <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
              {t('Delete music card')}
            </Button>
            {music
              ? (
                  <a
                    className={`${buttonBase} ${buttonVariants.strong}`}
                    href={music.url}
                    target="_blank"
                    rel="noreferrer"
                    data-music-detail-link={music.provider}
                  >
                    {linkLabel}
                  </a>
                )
              : <Dialog.Close className={`${buttonBase} ${buttonVariants.flat}`}>{t('Close')}</Dialog.Close>}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Deleting a card leaves placed copies on the board: they stay as snapshots. */
function MusicDeleteDialog({ photoId, onClose }: { photoId: string | null, onClose: () => void }) {
  const t = useT()
  const allPhotos = useStore(s => s.photos)
  const deletePhotoAsset = useStore(s => s.deletePhotoAsset)
  const uses = useAssetUses()
  const placed = photoId == null ? 0 : uses.get(photoId) ?? 0
  const name = allPhotos.find(p => p.id === photoId)?.name ?? ''

  const confirm = () => {
    if (!photoId)
      return
    deletePhotoAsset(photoId)
    onClose()
    say(placed
      ? t('Music card deleted · the {n} placed copies stay on the board', { n: placed })
      : t('Music card deleted'))
  }

  return (
    <ConfirmDialog
      open={photoId != null}
      title={t('Delete music card?')}
      description={placed > 0
        ? t('“{name}” leaves the library. The copies already placed on a board stay where they are and keep rendering in the preview and the export.', { name })
        : t('“{name}” leaves the library. It is not placed anywhere yet.', { name })}
      confirmLabel={t('Delete music card')}
      danger
      onClose={onClose}
      onConfirm={confirm}
    />
  )
}

/** What an empty grid says: no cards at all, or none under this search. */
function MusicEmptyState({ empty }: { empty: boolean }) {
  const t = useT()
  return (
    <p className="m-0 flex flex-col items-center gap-2 px-4 py-16 text-center text-[12px] leading-[1.6] text-dim" data-music-empty="">
      <MorphIcon icon={Music} size={22} strokeWidth={1.5} className="text-faint" />
      {empty ? t('No music cards yet. Make one with the Music tool.') : t('No music cards match this search.')}
    </p>
  )
}
