import type { ReactNode } from 'react'
import type { Photo } from '../../lib/imageStore'
import { Dialog } from '@base-ui/react/dialog'
import { CalendarDays, Check, MapPin, Plus, Tag, Trash2, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useState } from 'react'
import { usePreview } from '../../hooks'
import { formatTakenAt } from '../../lib/exif'
import { useT } from '../../lib/i18n'
import { hasTag, tagsOf } from '../../lib/photoTags'
import { formatCoords, placeName } from '../../lib/regeo'
import { Button } from '../ui/button'
import { buttonBase, buttonVariants } from '../ui/buttonStyles'

/**
 * One photo's detail: the whole frame large enough to judge, the EXIF block the
 * import read from its header (capture time, the camera's WGS-84 fix and, when
 * the bundled district polygons contain it, the place it was taken), where the
 * board draws it, and the tag editor.
 *
 * A dialog rather than a route: the card is a grid item and the app's detail
 * surfaces are dialogs (the crop report, the export preview, the sticker
 * maker), so a photo has no deep link of its own to keep.
 */
export function PhotoDetail({ photo, uses, allTags, onTag, onUntag, onDelete, onClose }: {
  /** The photo on show; null while the dialog is closed. */
  photo: Photo | null
  /** How many places on the board draw it (0 = unused). */
  uses: number
  /** Every tag there is, for the suggestions. */
  allTags: string[]
  onTag: (tag: string) => void
  onUntag: (tag: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  const t = useT()
  const preview = usePreview(photo)
  const [draft, setDraft] = useState('')

  const tags = photo ? tagsOf(photo) : []
  const suggestions = allTags.filter(tag => !(photo && hasTag(photo, tag)))
  const taken = formatTakenAt(photo?.takenAt)

  const add = () => {
    const name = draft.trim()
    if (!name)
      return
    onTag(name)
    setDraft('')
  }

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
          className="fixed z-(--z-modal) left-1/2 top-1/2 flex max-h-[min(90dvh,760px)] w-[min(760px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]"
          data-photo-detail=""
        >
          <header className="flex flex-none items-center gap-2.5 border-b border-line py-2 pl-4 pr-2">
            <Dialog.Title className="m-0 min-w-0 flex-1 truncate text-[13.5px] font-semibold" data-photo-detail-name="">
              {photo?.name ?? ''}
            </Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row">
            {/* `absolute inset-0` gives the img a definite box (a percentage
                height would fall back to the intrinsic size), so a 1x1 preview
                scales up instead of rendering as its own single pixel. */}
            <div className="relative min-h-[200px] min-w-0 flex-1 bg-pane-bg sm:min-h-[300px]" data-photo-detail-preview="">
              {preview
                ? <img src={preview.url} alt={photo?.name ?? ''} className="photo-in absolute inset-0 h-full w-full object-contain p-2 sm:p-3" draggable={false} />
                : null}
            </div>

            <aside className="flex w-full flex-none flex-col gap-3 border-t border-line p-3 sm:w-[260px] sm:border-t-0 sm:border-l">
              {/* EXIF: what the camera wrote, or that it wrote nothing. */}
              <section className="flex flex-col gap-1.5" data-photo-detail-exif="">
                <h2 className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{t('Details')}</h2>
                <Row icon={CalendarDays} label={t('Taken')}>
                  <span data-photo-detail-taken={taken ?? ''}>
                    {taken ?? t('No capture time')}
                  </span>
                </Row>
                <Row icon={MapPin} label={t('Location')}>
                  <PlaceField key={photo?.id ?? 'none'} photo={photo} />
                </Row>
                <Row icon={Tag} label={t('Size')}>
                  <span className="tabular-nums" data-photo-detail-size="">
                    {photo ? `${photo.trueW} × ${photo.trueH}` : ''}
                  </span>
                </Row>
                <Row icon={Check} label={t('Used')}>
                  <span data-photo-detail-usage={uses}>
                    {uses > 0 ? t('Used in {n} places on the board', { n: uses }) : t('Not placed on the board')}
                  </span>
                </Row>
              </section>

              <section className="flex flex-col gap-1.5 border-t border-line pt-3" data-photo-detail-tags="">
                <h2 className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{t('Tags')}</h2>
                {tags.length > 0
                  ? (
                      <div className="flex flex-wrap gap-1">
                        {tags.map(tag => (
                          <span
                            key={tag}
                            className="flex max-w-full items-center gap-1 border border-line bg-panel-2 py-px pl-1.5 pr-0.5 text-[11px] text-txt"
                            data-photo-detail-tag={tag}
                          >
                            <span className="truncate">
                              #
                              {tag}
                            </span>
                            <button
                              type="button"
                              className="grid h-[16px] w-[16px] flex-none cursor-pointer place-items-center border-0 bg-transparent p-0 text-faint transition-colors duration-(--dur-fast) hover:text-danger"
                              aria-label={t('Remove tag {tag}', { tag })}
                              data-photo-tag-remove={tag}
                              onClick={() => onUntag(tag)}
                            >
                              <MorphIcon icon={X} size={10} strokeWidth={2} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )
                  : <p className="m-0 text-[11.5px] text-faint" data-photo-detail-untagged="">{t('No tags on this photo yet')}</p>}

                <div className="flex items-center gap-1">
                  <input
                    className="box-border h-[26px] min-w-0 flex-1 border border-line-strong bg-panel-2 px-2 text-[11.5px] text-txt outline-0 placeholder:text-faint focus-visible:border-accent"
                    value={draft}
                    placeholder={t('Add a tag')}
                    aria-label={t('Add a tag')}
                    data-photo-tag-add-input=""
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter')
                        return
                      e.preventDefault()
                      add()
                    }}
                  />
                  <Button variant="strong" aria-label={t('Add a tag')} data-photo-tag-add-button="" onClick={add} disabled={!draft.trim()}>
                    <MorphIcon icon={Plus} size={12} strokeWidth={1.75} />
                  </Button>
                </div>

                {suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {suggestions.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        className="cursor-pointer border border-line bg-transparent px-1.5 py-px text-[10.5px] text-dim transition-colors duration-(--dur-fast) hover:bg-chip-hover hover:text-txt"
                        data-photo-tag-suggest={tag}
                        onClick={() => onTag(tag)}
                      >
                        +
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </div>

          <div className="flex flex-none items-center justify-between gap-2 border-t border-line px-3 py-2.5">
            <Button variant="danger" data-photo-detail-delete="" onClick={onDelete}>
              <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
              {t('Delete photo')}
            </Button>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.strong}`}>{t('Close')}</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Where the photo was taken: the camera's WGS-84 fix resolved against the
 * bundled district polygons. The lookup is a lazy import, so it lands after the
 * dialog is up and the coordinates stand in until it answers; a photo with no
 * fix says so. Mounted per photo (`key`), so a resolved name never outlives the
 * frame it belongs to.
 */
function PlaceField({ photo }: { photo: Photo | null }) {
  const t = useT()
  const [name, setName] = useState<string | null>(null)
  const lat = photo?.gps?.lat
  const lng = photo?.gps?.lng

  useEffect(() => {
    if (lat == null || lng == null)
      return
    let alive = true
    void placeName(lat, lng).then((found) => {
      if (alive && found)
        setName(found)
    })
    return () => {
      alive = false
    }
  }, [lat, lng])

  if (lat == null || lng == null)
    return <span data-photo-detail-place="">{t('No GPS fix')}</span>
  return <span data-photo-detail-place={name ?? ''}>{name ?? formatCoords(lat, lng)}</span>
}

/** One EXIF line: icon, its label, and the value (which may wrap). */
function Row({ icon, label, children }: { icon: typeof Tag, label: string, children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-[11.5px] leading-[1.5]">
      <MorphIcon icon={icon} size={12} strokeWidth={1.75} className="mt-[2px] flex-none text-faint" />
      <span className="w-[52px] flex-none text-faint">{label}</span>
      <span className="min-w-0 flex-1 break-words text-txt">{children}</span>
    </div>
  )
}
