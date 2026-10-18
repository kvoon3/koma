import type { Photo } from '../../lib/imageStore'
import { Menu } from '@base-ui/react/menu'
import { Check, FolderInput, Trash2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { memo } from 'react'
import { useInView, useThumb } from '../../hooks'
import { useT } from '../../lib/i18n'
import { menuItemCls, menuPopupCls, menuSeparatorCls } from '../ui/menu'
import { Tip } from '../ui/tip'

const actionCls = 'grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-faint transition-colors duration-(--dur-fast) hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt disabled:cursor-default disabled:opacity-35'

/**
 * One sticker asset on the management page: the sticker itself on the
 * transparency checkerboard (its PNG keeps alpha, so the checker is what says
 * "transparent", the same read the export preview gives it), its folder, how
 * many places on the board draw it, and the two actions that act on the
 * asset: move to another folder, delete.
 */
export const StickerCard = memo(({
  photo,
  folder,
  uses,
  folders,
  onMove,
  onDelete,
}: {
  photo: Photo
  /** The folder's display name (a translated "Unsorted" for the default one). */
  folder: string
  /** How many places on the board draw this sticker (0 = unused). */
  uses: number
  /** Every folder this sticker could move to, in chip order (Unsorted first). */
  folders: string[]
  onMove: (folder: string) => void
  onDelete: () => void
}) => {
  const t = useT()
  const [ref, seen] = useInView<HTMLDivElement>('300px')
  const url = useThumb(photo, seen)
  const used = uses > 0

  return (
    <article
      ref={ref}
      className="group flex min-w-0 flex-col border border-line bg-panel"
      data-sticker-card=""
      data-sticker-id={photo.id}
      data-sticker-usage={used ? 'used' : 'unused'}
      data-sticker-folder={folder}
    >
      {/* The checker is the stage's transparency read; `object-contain` keeps
          the whole sticker (its box is the artwork, not a frame) in view. */}
      <div className="stage-clear relative flex aspect-[4/3] items-center justify-center overflow-hidden">
        {url
          ? <img src={url} alt={photo.name} className="max-h-full max-w-full object-contain p-4" draggable={false} />
          : <span className="block h-full w-full" />}
        <span
          className={`absolute left-1.5 top-1.5 flex items-center gap-1 border px-1.5 py-px text-[9.5px] font-semibold tabular-nums backdrop-blur-[3px] ${used ? 'border-transparent bg-accent text-on-accent' : 'border-line-strong bg-badge-bg text-dim'}`}
          data-sticker-usage-badge=""
          title={used ? t('Used in {n} places on the board', { n: uses }) : t('Not placed on the board')}
        >
          {used && <MorphIcon icon={Check} size={9} strokeWidth={2.5} />}
          {used ? t('Used {n}', { n: uses }) : t('Unused')}
        </span>
      </div>

      <div className="flex items-center gap-1 border-t border-line py-1 pl-2 pr-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[11.5px] text-txt" title={photo.name} data-sticker-name="">{photo.name}</span>
          <span className="truncate text-[10px] text-faint">{folder}</span>
        </div>

        <Menu.Root>
          <Tip
            label={t('Move to folder')}
            trigger={(
              <Menu.Trigger className={actionCls} aria-label={t('Move to folder')} data-sticker-move="">
                <MorphIcon icon={FolderInput} size={13} strokeWidth={1.75} />
              </Menu.Trigger>
            )}
          />
          <Menu.Portal>
            <Menu.Positioner sideOffset={4} align="end" className="z-[260] select-none outline-0">
              <Menu.Popup className={menuPopupCls}>
                <Menu.Group>
                  <Menu.GroupLabel className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                    {t('Move to folder')}
                  </Menu.GroupLabel>
                  {folders.map(name => (
                    <Menu.Item
                      key={name}
                      className={menuItemCls}
                      onClick={() => onMove(name)}
                      data-move-to={name}
                    >
                      {name}
                      {name === folder && <MorphIcon icon={Check} size={12} strokeWidth={2} className="ml-auto pl-4 text-accent" />}
                    </Menu.Item>
                  ))}
                </Menu.Group>
                <Menu.Separator className={menuSeparatorCls} />
                <Menu.Item className={`${menuItemCls} text-danger`} onClick={onDelete} data-sticker-delete="">
                  <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
                  {t('Delete sticker')}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <Tip
          label={t('Delete sticker')}
          trigger={(
            <button
              type="button"
              className={`${actionCls} hover:not-disabled:text-danger`}
              aria-label={t('Delete sticker')}
              onClick={onDelete}
              data-sticker-delete-button=""
            >
              <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
            </button>
          )}
        />
      </div>
    </article>
  )
})
