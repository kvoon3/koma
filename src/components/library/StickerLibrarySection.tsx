import type { Photo } from '../../lib/imageStore'
import type { GroupPick, LibrarySectionProps } from '../../lib/library'
import type { StickerRecipe } from '../../lib/stickerRecipe'
import { FolderPlus, Pencil, Sticker as StickerIcon, Trash2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo, useState } from 'react'
import { useAssetUses } from '../../hooks'
import { useT } from '../../lib/i18n'
import { matchesQuery, normalizeQuery } from '../../lib/library'
import { addFolder, folderOf, MAX_FOLDER_NAME, renameFolder, stickerAssetsOf } from '../../lib/stickerLibrary'
import { recipeOf } from '../../lib/stickerRecipe'
import { say } from '../../lib/toast'
import { scrollFadeStyleX, useScrollFade } from '../../lib/useScrollFade'
import { useStore } from '../../store'
import { ConfirmDialog } from '../ConfirmDialog'
import { StickerCard } from '../sticker/StickerCard'
import { StickerEraseDialog } from '../StickerEraseDialog'
import { StickerMakerDialog } from '../StickerMakerDialog'
import { Button } from '../ui/button'
import { NamePrompt } from '../ui/NamePrompt'
import { Tip } from '../ui/tip'
import { chipCls, chipOffCls, chipOnCls, countCls, toolCls } from './chips'

interface ReEditState { photo: Photo, recipe: StickerRecipe, seq: number }
interface ErasingState { photo: Photo, src: string }
interface FolderPromptState { mode: 'create' | 'rename', seq: number }

/**
 * The sticker half of the library: the maker's output, grouped by a one-level
 * folder, with where each one is drawn. Deleting an asset removes it from the
 * library but never from a board: placed copies are snapshots, so the preview
 * and the export keep drawing them (see `lib/stickerLibrary`).
 */
export function StickerLibrarySection({ items, groups, pick, onPick, query, solo }: LibrarySectionProps) {
  const t = useT()

  const moveStickerToFolder = useStore(s => s.moveStickerToFolder)

  /** All, Unsorted, then the named folders. */
  const unsorted = t('Unsorted')
  /** The sticker awaiting a delete confirm. */
  const [deleting, setDeleting] = useState<string | null>(null)
  const [folderAsk, setFolderAsk] = useState<string | null>(null)
  /**
   * The sticker whose silhouette is being painted over (see StickerEraseDialog)
   * and the one being reopened in the maker with its own recipe. Both act on
   * the library only: they save a new asset and push no board history.
   */
  const [erasing, setErasing] = useState<ErasingState | null>(null)
  const [reEditing, setReEditing] = useState<ReEditState | null>(null)
  const folderPrompt = useFolderPrompt(groups, pick, onPick)

  // Usage: every place the board draws a photo id (pane photos, pane stickers,
  // board stickers) over all groups, plus the collage background. The photo
  // page reads the same hook, so the two badges cannot disagree.
  const uses = useAssetUses()

  const label = (folder: string) => folder || unsorted
  const countIn = (folder: GroupPick) => (folder == null
    ? items.length
    : items.filter(s => folderOf(s) === folder).length)

  const q = normalizeQuery(query)
  const shown = items.filter(s => (pick == null || folderOf(s) === pick) && matchesQuery(s, q))

  /**
   * The erase door's own two moments: the sticker's PNG is handed to the dialog
   * as an object URL, minted on the click and released on the close. It lives in
   * the click, not in an effect, so a StrictMode remount cannot revoke the URL
   * the editor is about to decode.
   */
  const openErase = (photo: Photo) => {
    if (erasing)
      URL.revokeObjectURL(erasing.src)
    setErasing({ photo, src: URL.createObjectURL(photo.file) })
  }
  const closeErase = () => {
    if (erasing)
      URL.revokeObjectURL(erasing.src)
    setErasing(null)
  }

  return (
    <section className="flex flex-col [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line" data-library-section="sticker">
      <div className="flex items-baseline gap-2 px-3 pb-1.5 pt-3 sm:px-4 sm:pt-4">
        <h2 className="m-0 text-[13.5px] font-semibold text-txt">{t('Stickers')}</h2>
        <span className="text-[11.5px] tabular-nums text-dim" data-library-section-count="">{items.length}</span>
      </div>
      {solo && (
        <StickerFolderBar
          pick={pick}
          folders={groups}
          unsorted={unsorted}
          countIn={countIn}
          onPick={onPick}
          onOpenPrompt={folderPrompt.open}
          onAskDelete={setFolderAsk}
        />
      )}

      <div className="px-3 pb-4 sm:px-4">
        {shown.length > 0
          ? (
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5"
                data-sticker-grid=""
              >
                {shown.map((p) => {
                  // The recipe is what the Re-edit door needs; a legacy asset
                  // has none, so the door is not drawn at all.
                  const recipe = recipeOf(p)
                  return (
                    <StickerCard
                      key={p.id}
                      photo={p}
                      folder={label(folderOf(p))}
                      folderKey={folderOf(p)}
                      uses={uses.get(p.id) ?? 0}
                      // Keys, not labels: a folder the user calls "Unsorted"
                      // still moves to itself rather than to the default bucket.
                      folders={['', ...groups]}
                      onMove={folder => moveStickerToFolder(p.id, folder)}
                      onDelete={() => setDeleting(p.id)}
                      onErase={() => openErase(p)}
                      onReEdit={recipe ? () => setReEditing(r => ({ photo: p, recipe, seq: (r?.seq ?? 0) + 1 })) : null}
                    />
                  )
                })}
              </div>
            )
          : <StickerEmptyState empty={items.length === 0} />}
      </div>

      <StickerLibraryDialogs
        reEditing={reEditing}
        erasing={erasing}
        onCloseReEdit={() => setReEditing(null)}
        onCloseErase={closeErase}
      />

      <FolderNamePrompt
        prompt={folderPrompt.prompt}
        error={folderPrompt.error}
        pick={pick}
        onSubmit={folderPrompt.submit}
        onClose={folderPrompt.close}
      />

      <FolderDeleteDialog
        folder={folderAsk}
        onClose={() => setFolderAsk(null)}
        onDeleted={() => {
          setFolderAsk(null)
          onPick(null)
        }}
      />

      <StickerDeleteDialog photoId={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

/**
 * The folder chips and their actions. The chips scroll on their own; the
 * folder actions stay put at the end of the row, so a phone never scrolls to
 * reach them.
 */
function StickerFolderBar({ pick, folders, unsorted, countIn, onPick, onOpenPrompt, onAskDelete }: {
  pick: GroupPick
  folders: string[]
  unsorted: string
  countIn: (folder: GroupPick) => number
  onPick: (pick: GroupPick) => void
  onOpenPrompt: (mode: 'create' | 'rename') => void
  onAskDelete: (folder: string) => void
}) {
  const t = useT()
  // The chip bar scrolls sideways on a phone; its cut edge fades like the tools
  // dock's row, so a half-seen folder name reads as "more this way" rather than
  // as a chip clipped mid-word.
  const chipFadeRef = useScrollFade<HTMLDivElement>('x')

  return (
    <div className="flex flex-none flex-col gap-1.5 border-b border-line bg-panel px-3 py-1.5 sm:flex-row sm:items-center sm:px-4">
      {/* Chips scroll on their own; the folder actions stay put at the end of
          the row, so a phone never scrolls to reach them. One row child only:
          the fade hook watches the scroller and its first child, so a new
          folder re-measures the fade itself. */}
      <div
        ref={chipFadeRef}
        style={scrollFadeStyleX}
        data-folder-chips=""
        className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar-thumb]:bg-strip-thumb"
      >
        <div className="flex w-max items-center gap-1.5">
          <FolderChip active={pick == null} label={t('All')} count={countIn(null)} onClick={() => onPick(null)} pick="__all" />
          <FolderChip active={pick === ''} label={unsorted} count={countIn('')} onClick={() => onPick('')} pick={unsorted} />
          {folders.map(f => (
            <FolderChip key={f} active={pick === f} label={f} count={countIn(f)} onClick={() => onPick(f)} pick={f} />
          ))}
        </div>
      </div>
      <div className="flex flex-none items-center justify-end gap-1.5 sm:justify-start">
        {/* Rename / delete act on the picked folder; All has neither and the
            default folder only groups what was never filed. */}
        {pick != null && pick !== '' && (
          <>
            <Tip
              label={t('Rename folder')}
              trigger={(
                <button
                  type="button"
                  className={toolCls}
                  aria-label={t('Rename folder')}
                  data-folder-rename=""
                  onClick={() => onOpenPrompt('rename')}
                >
                  <MorphIcon icon={Pencil} size={13} strokeWidth={1.75} />
                </button>
              )}
            />
            <Tip
              label={t('Delete folder')}
              trigger={(
                <button
                  type="button"
                  className={toolCls}
                  aria-label={t('Delete folder')}
                  data-folder-delete=""
                  onClick={() => onAskDelete(pick)}
                >
                  <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
                </button>
              )}
            />
          </>
        )}
        <span className="flex flex-none">
          <Button
            variant="strong"
            aria-label={t('New folder')}
            data-folder-new=""
            onClick={() => onOpenPrompt('create')}
          >
            <MorphIcon icon={FolderPlus} size={12} strokeWidth={1.75} />
            <span className="max-sm:hidden">{t('New folder')}</span>
          </Button>
        </span>
      </div>
    </div>
  )
}

function FolderChip({ active, label, count, onClick, pick }: {
  active: boolean
  label: string
  count: number
  onClick: () => void
  pick: string
}) {
  return (
    <button
      type="button"
      className={`${chipCls} ${active ? chipOnCls : chipOffCls}`}
      aria-pressed={active}
      onClick={onClick}
      data-folder-chip={pick}
    >
      {label}
      <span className={countCls}>{count}</span>
    </button>
  )
}

/**
 * Re-edit is the maker, seeded from the recipe when the page reopens an
 * existing sticker, saving into that sticker's own folder. Each opening is its
 * own mount, so the recipe is read once.
 */
function StickerLibraryDialogs({ reEditing, erasing, onCloseReEdit, onCloseErase }: {
  reEditing: ReEditState | null
  erasing: ErasingState | null
  onCloseReEdit: () => void
  onCloseErase: () => void
}) {
  return (
    <>
      <StickerMakerDialog
        key={`reedit:${reEditing?.seq ?? 0}`}
        open={reEditing != null}
        target={reEditing ? { kind: 'library', folder: folderOf(reEditing.photo) } : null}
        reEdit={reEditing}
        onClose={onCloseReEdit}
      />

      <StickerEraseDialog
        open={erasing != null}
        photo={erasing?.photo ?? null}
        src={erasing?.src ?? null}
        onClose={onCloseErase}
      />
    </>
  )
}

/**
 * The folder name dialog's state: `seq` makes every opening its own mount, so
 * the field starts from that opening's name rather than from the last attempt.
 */
function useFolderPrompt(folders: string[], pick: GroupPick, setPick: (pick: GroupPick) => void) {
  const t = useT()
  const addStickerFolder = useStore(s => s.addStickerFolder)
  const renameStickerFolder = useStore(s => s.renameStickerFolder)
  const [prompt, setPrompt] = useState<FolderPromptState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = (mode: FolderPromptState['mode']) => {
    setError(null)
    setPrompt(p => ({ mode, seq: (p?.seq ?? 0) + 1 }))
  }

  const close = () => {
    setPrompt(null)
    setError(null)
  }

  const submit = (name: string): boolean => {
    const res = prompt?.mode === 'rename'
      ? renameFolder(folders, pick as string, name)
      : addFolder(folders, name)
    if (!res.ok) {
      setError(res.reason === 'empty'
        ? t('Type a folder name')
        : res.reason === 'duplicate' ? t('A folder with that name already exists') : t('That folder no longer exists'))
      return false
    }
    const done = prompt?.mode === 'rename'
      ? renameStickerFolder(pick as string, name)
      : addStickerFolder(name)
    if (!done) {
      setError(t('That folder no longer exists'))
      return false
    }
    // A rename keeps its folder open; a new folder leaves the view where it
    // was (jumping into an empty folder hides the stickers you just sorted).
    if (prompt?.mode === 'rename')
      setPick(res.name)
    setError(null)
    return true
  }

  return { prompt, error, open, close, submit }
}

function FolderNamePrompt({ prompt, error, pick, onSubmit, onClose }: {
  prompt: FolderPromptState | null
  error: string | null
  pick: GroupPick
  onSubmit: (name: string) => boolean
  onClose: () => void
}) {
  const t = useT()
  return (
    <NamePrompt
      key={prompt == null ? 'closed' : `${prompt.mode}:${prompt.seq}`}
      open={prompt != null}
      title={prompt?.mode === 'rename' ? t('Rename folder') : t('New folder')}
      initial={prompt?.mode === 'rename' ? (pick ?? '') : ''}
      confirmLabel={prompt?.mode === 'rename' ? t('Rename') : t('Create')}
      error={error}
      field="folder"
      placeholder={t('Folder name')}
      maxLength={MAX_FOLDER_NAME}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}

/** Deleting a folder moves its stickers to Unsorted; the stickers themselves stay. */
function FolderDeleteDialog({ folder, onClose, onDeleted }: {
  folder: string | null
  onClose: () => void
  onDeleted: () => void
}) {
  const t = useT()
  const allPhotos = useStore(s => s.photos)
  const deleteStickerFolder = useStore(s => s.deleteStickerFolder)
  const stickers = useMemo(() => stickerAssetsOf(allPhotos), [allPhotos])
  const moved = folder == null ? 0 : stickers.filter(s => folderOf(s) === folder).length

  const confirm = () => {
    if (folder == null)
      return
    deleteStickerFolder(folder)
    onDeleted()
    say(moved
      ? t('Folder deleted · {n} stickers moved to Unsorted', { n: moved })
      : t('Folder deleted'))
  }

  return (
    <ConfirmDialog
      open={folder != null}
      title={t('Delete folder?')}
      description={moved
        ? t('Its {n} stickers move to Unsorted. The stickers themselves are not deleted.', { n: moved })
        : t('This folder is empty.')}
      confirmLabel={t('Delete folder')}
      danger
      onClose={onClose}
      onConfirm={confirm}
    />
  )
}

/** Deleting a sticker leaves placed copies on the board: they stay as snapshots. */
function StickerDeleteDialog({ photoId, onClose }: { photoId: string | null, onClose: () => void }) {
  const t = useT()
  const allPhotos = useStore(s => s.photos)
  const deleteStickerAsset = useStore(s => s.deleteStickerAsset)
  const uses = useAssetUses()
  const placed = photoId == null ? 0 : uses.get(photoId) ?? 0
  const name = allPhotos.find(p => p.id === photoId)?.name ?? ''

  const confirm = () => {
    if (!photoId)
      return
    deleteStickerAsset(photoId)
    onClose()
    say(placed
      ? t('Sticker deleted · the {n} placed copies stay on the board', { n: placed })
      : t('Sticker deleted'))
  }

  return (
    <ConfirmDialog
      open={photoId != null}
      title={t('Delete sticker?')}
      description={placed > 0
        ? t('“{name}” leaves the library. The copies already placed on a board stay where they are and keep rendering in the preview and the export.', { name })
        : t('“{name}” leaves the library. It is not placed anywhere yet.', { name })}
      confirmLabel={t('Delete sticker')}
      danger
      onClose={onClose}
      onConfirm={confirm}
    />
  )
}

/** What an empty grid says: no stickers at all, or none under this filter or search. */
function StickerEmptyState({ empty }: { empty: boolean }) {
  const t = useT()
  return (
    <p className="m-0 flex flex-col items-center gap-2 px-4 py-16 text-center text-[12px] leading-[1.6] text-dim" data-sticker-empty="">
      <MorphIcon icon={StickerIcon} size={22} strokeWidth={1.5} className="text-faint" />
      {empty ? t('No stickers here yet. Make one with the New sticker button above.') : t('No stickers match this search or filter.')}
    </p>
  )
}
