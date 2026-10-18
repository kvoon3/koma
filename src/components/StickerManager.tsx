import { useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, FolderPlus, Pencil, Search, Sticker as StickerIcon, Trash2, WandSparkles } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo, useState } from 'react'
import { useT } from '../lib/i18n'
import { addFolder, folderOf, referenceCounts, renameFolder, stickerAssetsOf } from '../lib/stickerLibrary'
import { say } from '../lib/toast'
import { scrollFadeStyleX, useScrollFade } from '../lib/useScrollFade'
import { useStore } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { FolderPrompt } from './sticker/FolderPrompt'
import { StickerCard } from './sticker/StickerCard'
import { StickerMakerDialog } from './StickerMakerDialog'
import { Button } from './ui/button'
import { Tip } from './ui/tip'

/** Which chip is picked: every sticker, the default folder, or one named folder. */
type FolderPick = null | '' | string

const chipCls = 'flex flex-none cursor-pointer items-center gap-1 whitespace-nowrap border px-2 py-[3px] text-[11.5px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97]'
const chipOnCls = 'border-transparent bg-accent text-on-accent'
const chipOffCls = 'border-line bg-transparent text-dim hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt'
const countCls = 'tabular-nums opacity-60'

const backCls = 'grid h-[26px] w-[26px] flex-none cursor-pointer place-items-center rounded-none border border-line bg-transparent p-0 text-dim transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt pointer-coarse:h-[32px] pointer-coarse:w-[32px]'

/**
 * `#/stickers`: sticker management, a destination of its own rather than a
 * drawer over the board. It lists the assets the sticker maker produced (the
 * photo library lists the rest), groups them by a one-level folder, and shows
 * where each one is drawn. Deleting an asset removes it from the library but
 * never from a board: placed copies are snapshots, so the preview and the
 * export keep drawing them (see `lib/stickerLibrary`).
 *
 * The route is entered from the top bar's Photo menu and leaves through the
 * back chip, which returns wherever it was opened from.
 */
export function StickerManager() {
  const t = useT()
  const navigate = useNavigate()
  const router = useRouter()

  const allPhotos = useStore(s => s.photos)
  const folders = useStore(s => s.stickerFolders)
  const workspaces = useStore(s => s.workspaces)
  const parkedBoards = useStore(s => s.parkedBoards)
  const bgImage = useStore(s => s.bgImage)

  const addStickerFolder = useStore(s => s.addStickerFolder)
  const renameStickerFolder = useStore(s => s.renameStickerFolder)
  const deleteStickerFolder = useStore(s => s.deleteStickerFolder)
  const moveStickerToFolder = useStore(s => s.moveStickerToFolder)
  const deleteStickerAsset = useStore(s => s.deleteStickerAsset)

  /** All, Unsorted, then the named folders. */
  const unsorted = t('Unsorted')
  const [rawPick, setRawPick] = useState<FolderPick>(null)
  // A folder that vanished (deleted on another surface) falls back to All.
  const pick: FolderPick = rawPick && !folders.includes(rawPick) ? null : rawPick
  const [query, setQuery] = useState('')
  /**
   * The open name dialog: a new folder, or the one being renamed. `seq` makes
   * every opening its own mount, so the field starts from that opening's name
   * rather than from the last attempt.
   */
  const [prompt, setPrompt] = useState<{ mode: 'create' | 'rename', seq: number } | null>(null)
  const [promptError, setPromptError] = useState<string | null>(null)
  /** The sticker awaiting a delete confirm. */
  const [deleting, setDeleting] = useState<string | null>(null)
  const [folderAsk, setFolderAsk] = useState<string | null>(null)
  /**
   * The maker, opened from this page: its save files the sticker in a folder.
   * Every opening is its own mount (the `seq` key), so a new sticker starts from
   * an empty stage instead of from the last one's pick and effects.
   */
  const [making, setMaking] = useState<{ seq: number } | null>(null)
  // The chip bar scrolls sideways on a phone; its cut edge fades like the tools
  // dock's row, so a half-seen folder name reads as "more this way" rather than
  // as a chip clipped mid-word.
  const chipFadeRef = useScrollFade<HTMLDivElement>('x')

  const stickers = useMemo(() => stickerAssetsOf(allPhotos), [allPhotos])

  // Usage: every place the board draws a photo id (pane photos, pane stickers,
  // board stickers) over all groups, plus the collage background.
  const uses = useMemo(
    () => referenceCounts(
      [...workspaces, ...Object.values(parkedBoards).flatMap(b => b.workspaces)],
      [bgImage?.photoId],
    ),
    [workspaces, parkedBoards, bgImage],
  )

  const label = (folder: string) => folder || unsorted
  const countIn = (folder: FolderPick) => (folder == null
    ? stickers.length
    : stickers.filter(s => folderOf(s) === folder).length)

  const q = query.trim().toLocaleLowerCase()
  const shown = stickers.filter((s) => {
    if (pick != null && folderOf(s) !== pick)
      return false
    return !q || s.name.toLocaleLowerCase().includes(q)
  })

  const back = () => {
    useStore.getState().clearSelection()
    // Opened from the board, back goes to the board; a direct URL has nothing
    // behind it, so it lands on the grid instead of leaving the app.
    if (router.history.length > 1)
      router.history.back()
    else
      void navigate({ to: '/' })
  }

  const submitFolder = (name: string): boolean => {
    const res = prompt?.mode === 'rename'
      ? renameFolder(folders, pick as string, name)
      : addFolder(folders, name)
    if (!res.ok) {
      setPromptError(res.reason === 'empty'
        ? t('Type a folder name')
        : res.reason === 'duplicate' ? t('A folder with that name already exists') : t('That folder no longer exists'))
      return false
    }
    const done = prompt?.mode === 'rename'
      ? renameStickerFolder(pick as string, name)
      : addStickerFolder(name)
    if (!done) {
      setPromptError(t('That folder no longer exists'))
      return false
    }
    // A rename keeps its folder open; a new folder leaves the view where it
    // was (jumping into an empty folder hides the stickers you just sorted).
    if (prompt?.mode === 'rename')
      setRawPick(res.name)
    setPromptError(null)
    return true
  }

  const confirmDeleteFolder = () => {
    if (folderAsk == null)
      return
    const moved = countIn(folderAsk)
    deleteStickerFolder(folderAsk)
    setFolderAsk(null)
    setRawPick(null)
    say(moved
      ? t('Folder deleted · {n} stickers moved to Unsorted', { n: moved })
      : t('Folder deleted'))
  }

  const confirmDeleteSticker = () => {
    const id = deleting
    if (!id)
      return
    const placed = uses.get(id) ?? 0
    deleteStickerAsset(id)
    setDeleting(null)
    say(placed
      ? t('Sticker deleted · the {n} placed copies stay on the board', { n: placed })
      : t('Sticker deleted'))
  }

  const deletingName = allPhotos.find(p => p.id === deleting)?.name ?? ''
  /** Where a made sticker lands: the picked folder, or Unsorted on All. */
  const makeTarget = useMemo(() => ({ kind: 'library' as const, folder: pick ?? '' }), [pick])

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas" data-sticker-manager="">
      <header className="flex flex-none flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line bg-panel px-3 py-2 sm:px-4">
        <Tip
          label={t('Back')}
          trigger={(
            <button type="button" className={backCls} aria-label={t('Back')} onClick={back} data-stickers-back="">
              <MorphIcon icon={ArrowLeft} size={15} strokeWidth={1.75} />
            </button>
          )}
        />
        <h1 className="m-0 text-[13.5px] font-semibold text-txt">{t('Stickers')}</h1>
        <span className="text-[11.5px] text-dim tabular-nums" data-sticker-total="">{stickers.length}</span>
        <span className="flex-1" />
        <label className="flex h-[26px] w-full min-w-0 items-center gap-1.5 border border-line-strong bg-panel-2 px-1.5 sm:w-[190px]">
          <MorphIcon icon={Search} size={12} strokeWidth={1.75} className="flex-none text-faint" />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-[11.5px] text-txt outline-0 placeholder:text-faint"
            value={query}
            placeholder={t('Search stickers')}
            aria-label={t('Search stickers')}
            data-sticker-search=""
            onChange={e => setQuery(e.target.value)}
          />
        </label>
      </header>

      <div className="flex flex-none items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5 sm:px-4">
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
            <FolderChip active={pick == null} label={t('All')} count={countIn(null)} onClick={() => setRawPick(null)} pick="__all" />
            <FolderChip active={pick === ''} label={unsorted} count={countIn('')} onClick={() => setRawPick('')} pick={unsorted} />
            {folders.map(f => (
              <FolderChip key={f} active={pick === f} label={f} count={countIn(f)} onClick={() => setRawPick(f)} pick={f} />
            ))}
          </div>
        </div>
        {/* Rename / delete act on the picked folder; All has neither and the
            default folder only groups what was never filed. */}
        {pick != null && pick !== '' && (
          <>
            <Tip
              label={t('Rename folder')}
              trigger={(
                <button
                  type="button"
                  className={backCls}
                  aria-label={t('Rename folder')}
                  data-folder-rename=""
                  onClick={() => {
                    setPromptError(null)
                    setPrompt(p => ({ mode: 'rename', seq: (p?.seq ?? 0) + 1 }))
                  }}
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
                  className={backCls}
                  aria-label={t('Delete folder')}
                  data-folder-delete=""
                  onClick={() => setFolderAsk(pick)}
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
            onClick={() => {
              setPromptError(null)
              setPrompt(p => ({ mode: 'create', seq: (p?.seq ?? 0) + 1 }))
            }}
          >
            <MorphIcon icon={FolderPlus} size={12} strokeWidth={1.75} />
            <span className="max-sm:hidden">{t('New folder')}</span>
          </Button>
        </span>
        {/* The page's own maker: the same dialog the editor's Make tool opens,
            saving into the picked folder instead of onto the board. */}
        <span className="flex flex-none">
          <Button
            variant="strong"
            aria-label={t('New sticker')}
            data-sticker-new=""
            onClick={() => setMaking(m => ({ seq: (m?.seq ?? 0) + 1 }))}
          >
            <MorphIcon icon={WandSparkles} size={12} strokeWidth={1.75} />
            <span className="max-sm:hidden">{t('New sticker')}</span>
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 [&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-thumb]:bg-strip-thumb sm:p-4">
        {shown.length > 0
          ? (
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5"
                data-sticker-grid=""
              >
                {shown.map(p => (
                  <StickerCard
                    key={p.id}
                    photo={p}
                    folder={label(folderOf(p))}
                    folderKey={folderOf(p)}
                    uses={uses.get(p.id) ?? 0}
                    // Keys, not labels: a folder the user calls "Unsorted"
                    // still moves to itself rather than to the default bucket.
                    folders={['', ...folders]}
                    onMove={folder => moveStickerToFolder(p.id, folder)}
                    onDelete={() => setDeleting(p.id)}
                  />
                ))}
              </div>
            )
          : <StickerEmptyState />}
      </div>

      <StickerMakerDialog
        key={making?.seq ?? 0}
        open={making != null}
        target={makeTarget}
        onClose={() => setMaking(null)}
      />

      <FolderPrompt
        key={prompt == null ? 'closed' : `${prompt.mode}:${prompt.seq}`}
        open={prompt != null}
        title={prompt?.mode === 'rename' ? t('Rename folder') : t('New folder')}
        initial={prompt?.mode === 'rename' ? (pick ?? '') : ''}
        confirmLabel={prompt?.mode === 'rename' ? t('Rename') : t('Create')}
        error={promptError}
        onSubmit={submitFolder}
        onClose={() => {
          setPrompt(null)
          setPromptError(null)
        }}
      />

      <ConfirmDialog
        open={folderAsk != null}
        title={t('Delete folder?')}
        description={countIn(folderAsk)
          ? t('Its {n} stickers move to Unsorted. The stickers themselves are not deleted.', { n: countIn(folderAsk) })
          : t('This folder is empty.')}
        confirmLabel={t('Delete folder')}
        danger
        onClose={() => setFolderAsk(null)}
        onConfirm={confirmDeleteFolder}
      />

      <ConfirmDialog
        open={deleting != null}
        title={t('Delete sticker?')}
        description={(uses.get(deleting ?? '') ?? 0) > 0
          ? t('“{name}” leaves the library. The copies already placed on a board stay where they are and keep rendering in the preview and the export.', { name: deletingName })
          : t('“{name}” leaves the library. It is not placed anywhere yet.', { name: deletingName })}
        confirmLabel={t('Delete sticker')}
        danger
        onClose={() => setDeleting(null)}
        onConfirm={confirmDeleteSticker}
      />
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

/** What an empty grid says: no stickers at all, none in this folder, or none matching the search. */
function StickerEmptyState() {
  const t = useT()
  return (
    <p className="m-0 flex flex-col items-center gap-2 px-4 py-16 text-center text-[12px] leading-[1.6] text-dim" data-sticker-empty="">
      <MorphIcon icon={StickerIcon} size={22} strokeWidth={1.5} className="text-faint" />
      {t('No stickers here yet. Make one from a pane with the Make tool and it lands in this library.')}
    </p>
  )
}
