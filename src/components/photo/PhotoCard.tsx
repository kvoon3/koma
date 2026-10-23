import type { Photo } from '../../lib/imageStore'
import { Menu } from '@base-ui/react/menu'
import { Check, Tag, Trash2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { memo } from 'react'
import { useInView, useThumb } from '../../hooks'
import { formatTakenAt } from '../../lib/exif'
import { useT } from '../../lib/i18n'
import { hasTag } from '../../lib/photoTags'
import { menuGroupLabelCls, menuItemCls, menuPopupCls, menuSeparatorCls } from '../ui/menu'
import { Tip } from '../ui/tip'
import { TagGlyph } from './TagGlyph'

const actionCls = 'grid h-[22px] w-[22px] flex-none cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-faint transition-colors duration-(--dur-fast) hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt disabled:cursor-default disabled:opacity-35'

/** How many tag chips a card shows before it counts the rest. */
const CHIPS = 2

/**
 * One photo on the management page: the photo itself (cover-cropped, so a row
 * of cards scans as a contact sheet), how many places on the board draw it,
 * when the camera says it was taken, and the tags it wears. The whole picture
 * is the door to the detail view; the footer carries the two quick actions
 * (tag / delete) so the common edit never needs the dialog.
 */
export const PhotoCard = memo(({
  photo,
  uses,
  tags,
  allTags,
  onOpen,
  onPickTag,
  onToggleTag,
  onDelete,
}: {
  photo: Photo
  /** How many places on the board draw this photo (0 = unused). */
  uses: number
  /** The tags this photo wears, in the order they were attached. */
  tags: string[]
  /** Every tag there is (the menu toggles them). */
  allTags: string[]
  onOpen: () => void
  /** A chip in the footer filters the page by that tag. */
  onPickTag: (tag: string) => void
  onToggleTag: (tag: string) => void
  onDelete: () => void
}) => {
  const t = useT()
  const [ref, seen] = useInView<HTMLDivElement>('300px')
  const url = useThumb(photo, seen)
  const used = uses > 0
  const taken = formatTakenAt(photo.takenAt)
  const rest = tags.length - CHIPS

  return (
    <article
      ref={ref}
      className="group flex min-w-0 flex-col border border-line bg-panel"
      data-photo-card=""
      data-photo-id={photo.id}
      data-photo-usage={used ? 'used' : 'unused'}
      data-photo-taken={taken ?? ''}
      data-photo-tags={tags.join(',')}
    >
      <button
        type="button"
        className="relative block aspect-[4/3] w-full cursor-pointer overflow-hidden border-0 bg-thumb-bg p-0 outline-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        aria-label={t('Open {name}', { name: photo.name })}
        data-photo-open=""
        onClick={onOpen}
      >
        {url
          ? <img src={url} alt={photo.name} className="photo-in block h-full w-full object-cover" draggable={false} />
          : <span className="block h-full w-full" />}
        <span
          className={`absolute left-1.5 top-1.5 flex items-center gap-1 border px-1.5 py-px text-[9.5px] font-semibold tabular-nums backdrop-blur-[3px] ${used ? 'border-transparent bg-accent text-on-accent' : 'border-line-strong bg-badge-bg text-dim'}`}
          data-photo-usage-badge=""
          title={used ? t('Used in {n} places on the board', { n: uses }) : t('Not placed on the board')}
        >
          {used && <MorphIcon icon={Check} size={9} strokeWidth={2.5} />}
          {used ? t('Used {n}', { n: uses }) : t('Unused')}
        </span>
        {/* The capture time is the camera's, read from the EXIF at import: a
            photo without one carries no line rather than a made-up date. It is
            a fact to read, not a faint watermark, so it wears the badge fill
            plus `txt` ink rather than the dimmest tier. */}
        {taken && (
          <span
            className="absolute bottom-1.5 right-1.5 border border-line-strong bg-badge-bg px-1.5 py-[1.5px] text-[10.5px] font-medium tabular-nums text-txt backdrop-blur-[3px]"
            data-photo-taken-badge=""
          >
            {taken}
          </span>
        )}
      </button>

      <div className="flex items-start gap-1 border-t border-line py-1 pl-2 pr-1">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-[11.5px] text-txt" title={photo.name} data-photo-name="">{photo.name}</span>
          <span className="flex flex-wrap items-center gap-1">
            {tags.slice(0, CHIPS).map(tag => (
              <button
                key={tag}
                type="button"
                className="flex max-w-full cursor-pointer items-center gap-1 truncate rounded-none border border-line bg-transparent px-1 py-px text-[9.5px] text-dim transition-colors duration-(--dur-fast) hover:bg-chip-hover hover:text-txt"
                title={t('Show only {tag}', { tag })}
                data-photo-tag={tag}
                onClick={() => onPickTag(tag)}
              >
                <TagGlyph name={tag} size={9} className="text-faint" />
                <span className="truncate">
                  #
                  {tag}
                </span>
              </button>
            ))}
            {rest > 0 && (
              <span className="text-[9.5px] text-faint tabular-nums" data-photo-tag-rest="">
                +
                {rest}
              </span>
            )}
          </span>
        </div>

        <Menu.Root>
          <Tip
            label={t('Tags')}
            trigger={(
              <Menu.Trigger className={actionCls} aria-label={t('Tags')} data-photo-tag-menu="">
                <MorphIcon icon={Tag} size={13} strokeWidth={1.75} />
              </Menu.Trigger>
            )}
          />
          <Menu.Portal>
            <Menu.Positioner sideOffset={4} align="end" className="z-[260] select-none outline-0">
              <Menu.Popup className={menuPopupCls}>
                <Menu.Group>
                  <Menu.GroupLabel className={menuGroupLabelCls}>{t('Tags')}</Menu.GroupLabel>
                  {allTags.length === 0 && (
                    <Menu.Item className={menuItemCls} disabled>
                      {t('No tags yet')}
                    </Menu.Item>
                  )}
                  {allTags.map(tag => (
                    <Menu.Item
                      key={tag}
                      className={menuItemCls}
                      onClick={() => onToggleTag(tag)}
                      data-photo-toggle-tag={tag}
                    >
                      <TagGlyph name={tag} size={12} className="text-dim" />
                      <span className="truncate">{tag}</span>
                      {hasTag(photo, tag) && <MorphIcon icon={Check} size={12} strokeWidth={2} className="ml-auto pl-4 text-accent" />}
                    </Menu.Item>
                  ))}
                </Menu.Group>
                <Menu.Separator className={menuSeparatorCls} />
                <Menu.Item className={`${menuItemCls} text-danger`} onClick={onDelete} data-photo-delete="">
                  <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
                  {t('Delete photo')}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <Tip
          label={t('Delete photo')}
          trigger={(
            <button
              type="button"
              className={`${actionCls} hover:not-disabled:text-danger`}
              aria-label={t('Delete photo')}
              onClick={onDelete}
              data-photo-delete-button=""
            >
              <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
            </button>
          )}
        />
      </div>
    </article>
  )
})
