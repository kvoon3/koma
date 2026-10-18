import type { Photo } from '../../lib/imageStore'
import { Menu } from '@base-ui/react/menu'
import { Check, Eraser, FolderInput, Trash2, WandSparkles } from 'lucide'
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
 * many places on the board draw it, and the actions that act on the asset:
 * erase its silhouette, re-edit it in the maker (only when it carries a recipe),
 * move it to another folder, delete it.
 *
 * The two rows let a phone hold four actions without squeezing the name to
 * nothing: the name owns its line, the folder shares the action row.
 */
export const StickerCard = memo(({
  photo,
  folder,
  folderKey,
  uses,
  folders,
  onMove,
  onDelete,
  onErase,
  onReEdit,
}: {
  photo: Photo
  /** The folder's display name (a translated "Unsorted" for the default one). */
  folder: string
  /** The folder's key: '' for Unsorted, else the folder's own name. */
  folderKey: string
  /** How many places on the board draw this sticker (0 = unused). */
  uses: number
  /**
   * Every folder this sticker could move to, as keys in chip order: '' for
   * Unsorted (labelled here) then the named ones.
   */
  folders: string[]
  onMove: (folder: string) => void
  onDelete: () => void
  /** Paint this sticker's own alpha in the mask editor (every sticker has this door). */
  onErase: () => void
  /**
   * Reopen the maker over this sticker: its recipe's subject and controls.
   * Null for a legacy asset (made before re-editing), which offers Erase only.
   */
  onReEdit: (() => void) | null
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
      data-sticker-recipe={onReEdit ? 'yes' : 'no'}
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

      <div className="flex flex-col gap-0.5 border-t border-line px-2 py-1">
        <span className="truncate text-[11.5px] text-txt" title={photo.name} data-sticker-name="">{photo.name}</span>

        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[10px] text-faint" title={folder}>{folder}</span>

          {/* Erase repaints the final PNG's own alpha, so every sticker has it;
              Re-edit needs the maker's recipe and a legacy asset has none. */}
          <Tip
            label={t('Erase sticker')}
            trigger={(
              <button
                type="button"
                className={actionCls}
                aria-label={t('Erase sticker')}
                onClick={onErase}
                data-sticker-erase=""
              >
                <MorphIcon icon={Eraser} size={13} strokeWidth={1.75} />
              </button>
            )}
          />
          {onReEdit && (
            <Tip
              label={t('Re-edit sticker')}
              trigger={(
                <button
                  type="button"
                  className={actionCls}
                  aria-label={t('Re-edit sticker')}
                  onClick={onReEdit}
                  data-sticker-reedit=""
                >
                  <MorphIcon icon={WandSparkles} size={13} strokeWidth={1.75} />
                </button>
              )}
            />
          )}

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
                    {folders.map(key => (
                      <Menu.Item
                        key={key || '__unsorted'}
                        className={menuItemCls}
                        onClick={() => onMove(key)}
                        data-move-to={key || t('Unsorted')}
                      >
                        {key || t('Unsorted')}
                        {key === folderKey && <MorphIcon icon={Check} size={12} strokeWidth={2} className="ml-auto pl-4 text-accent" />}
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
      </div>
    </article>
  )
})
