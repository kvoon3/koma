import type { Photo } from '../../lib/imageStore'
import type { GroupPick, LibrarySectionProps } from '../../lib/library'
import { Images, Pencil, Tag, Trash2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo, useState } from 'react'
import { useAssetUses } from '../../hooks'
import { useT } from '../../lib/i18n'
import { matchesQuery, normalizeQuery } from '../../lib/library'
import { addTag, hasTag, isUntagged, MAX_TAG_NAME, renameTag, tagsOf } from '../../lib/photoTags'
import { photoAssetsOf } from '../../lib/stickerLibrary'
import { say } from '../../lib/toast'
import { scrollFadeStyleX, useScrollFade } from '../../lib/useScrollFade'
import { useStore } from '../../store'
import { ConfirmDialog } from '../ConfirmDialog'
import { PhotoCard } from '../photo/PhotoCard'
import { PhotoDetail } from '../photo/PhotoDetail'
import { Button } from '../ui/button'
import { NamePrompt } from '../ui/NamePrompt'
import { Tip } from '../ui/tip'
import { chipCls, chipOffCls, chipOnCls, countCls, toolCls } from './chips'

/**
 * The photo half of the library: a contact sheet with the tag chips above it.
 * Deleting a photo is the same rule as deleting a sticker: the record leaves
 * the library, unless a board still draws it, in which case it stays as a
 * hidden snapshot and the pane keeps rendering (see `lib/stickerLibrary`).
 */
export function PhotoLibrarySection({ items, groups, pick, onPick, query, solo }: LibrarySectionProps) {
  const t = useT()
  const tagPhoto = useStore(s => s.tagPhoto)
  const untagPhoto = useStore(s => s.untagPhoto)

  const uses = useAssetUses()

  /** All, Untagged, then the named tags. */
  const untagged = t('Untagged')
  /** The photo on show in the detail dialog. */
  const [openId, setOpenId] = useState<string | null>(null)
  /** The photo awaiting a delete confirm. */
  const [deleting, setDeleting] = useState<string | null>(null)
  const [tagAsk, setTagAsk] = useState<string | null>(null)
  const tagPrompt = useTagPrompt(groups, pick, onPick)

  const countIn = (tag: GroupPick) => (tag == null
    ? items.length
    : tag === '' ? items.filter(isUntagged).length : items.filter(p => hasTag(p, tag)).length)

  const q = normalizeQuery(query)
  const shown = items.filter(p => (pick == null || (pick === '' ? isUntagged(p) : hasTag(p, pick))) && matchesQuery(p, q))

  /** The photo the detail dialog is showing (null while it is closed). */
  const openPhoto = openId ? items.find(p => p.id === openId) ?? null : null

  return (
    <section className="flex flex-col [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line" data-library-section="photo">
      <div className="flex items-baseline gap-2 px-3 pb-1.5 pt-3 sm:px-4 sm:pt-4">
        <h2 className="m-0 text-[13.5px] font-semibold text-txt">{t('Photos')}</h2>
        <span className="text-[11.5px] tabular-nums text-dim" data-library-section-count="">{items.length}</span>
      </div>
      {solo && (
        <PhotoTagBar
          pick={pick}
          tags={groups}
          untagged={untagged}
          countIn={countIn}
          onPick={onPick}
          onOpenPrompt={tagPrompt.open}
          onAskDelete={setTagAsk}
        />
      )}

      <div className="px-3 pb-4 sm:px-4">
        {shown.length > 0
          ? (
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5"
                data-photo-grid=""
              >
                {shown.map(p => (
                  <PhotoCard
                    key={p.id}
                    photo={p}
                    uses={uses.get(p.id) ?? 0}
                    tags={tagsOf(p)}
                    allTags={groups}
                    onOpen={() => setOpenId(p.id)}
                    onPickTag={tag => onPick(tag)}
                    onToggleTag={(tag) => {
                      if (hasTag(p, tag))
                        untagPhoto(p.id, tag)
                      else
                        tagPhoto(p.id, tag)
                    }}
                    onDelete={() => setDeleting(p.id)}
                  />
                ))}
              </div>
            )
          : <PhotoEmptyState empty={items.length === 0} />}
      </div>

      <PhotoDetailDialog
        photo={openPhoto}
        allTags={groups}
        uses={uses}
        onRequestDelete={(id) => {
          setDeleting(id)
          setOpenId(null)
        }}
        onClose={() => setOpenId(null)}
      />

      <PhotoTagNamePrompt
        prompt={tagPrompt.prompt}
        error={tagPrompt.error}
        pick={pick}
        onSubmit={tagPrompt.submit}
        onClose={tagPrompt.close}
      />

      <PhotoTagDeleteDialog
        tag={tagAsk}
        onClose={() => setTagAsk(null)}
        onDeleted={() => {
          setTagAsk(null)
          onPick(null)
        }}
      />

      <PhotoDeleteDialog photoId={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

/**
 * The chip bar and its actions. The chips scroll on their own; the tag actions
 * stay put at the end of the row, so a phone never scrolls to reach them.
 */
function PhotoTagBar({ pick, tags, untagged, countIn, onPick, onOpenPrompt, onAskDelete }: {
  pick: GroupPick
  tags: string[]
  untagged: string
  countIn: (tag: GroupPick) => number
  onPick: (pick: GroupPick) => void
  onOpenPrompt: (mode: 'create' | 'rename') => void
  onAskDelete: (tag: string) => void
}) {
  const t = useT()
  // The chip bar scrolls sideways on a phone; its cut edge fades like the tools
  // dock's row (the sticker page's folder chips read the same way).
  const chipFadeRef = useScrollFade<HTMLDivElement>('x')

  return (
    // A phone stacks this row: at 320 the icon buttons leave the chip
    // scroller ~220px, where the fade's 48px band is a fifth of it and the
    // cut chip's border ghosts at the boundary, reading as a hard clip.
    <div className="flex flex-none flex-col gap-1.5 border-b border-line bg-panel px-3 py-1.5 sm:flex-row sm:items-center sm:px-4">
      <div
        ref={chipFadeRef}
        style={scrollFadeStyleX}
        data-tag-chips=""
        className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar-thumb]:bg-strip-thumb"
      >
        <div className="flex w-max items-center gap-1.5">
          <TagChip active={pick == null} label={t('All')} count={countIn(null)} onClick={() => onPick(null)} pick="__all" />
          <TagChip active={pick === ''} label={untagged} count={countIn('')} onClick={() => onPick('')} pick={untagged} />
          {tags.map(tag => (
            <TagChip key={tag} active={pick === tag} label={tag} count={countIn(tag)} onClick={() => onPick(tag)} pick={tag} />
          ))}
        </div>
      </div>
      <div className="flex flex-none items-center justify-end gap-1.5 sm:justify-start">
        {/* Rename / delete act on the picked tag; All has neither and
            Untagged only groups what wears nothing. */}
        {pick != null && pick !== '' && (
          <>
            <Tip
              label={t('Rename tag')}
              trigger={(
                <button
                  type="button"
                  className={toolCls}
                  aria-label={t('Rename tag')}
                  data-tag-rename=""
                  onClick={() => onOpenPrompt('rename')}
                >
                  <MorphIcon icon={Pencil} size={13} strokeWidth={1.75} />
                </button>
              )}
            />
            <Tip
              label={t('Delete tag')}
              trigger={(
                <button
                  type="button"
                  className={toolCls}
                  aria-label={t('Delete tag')}
                  data-tag-delete=""
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
            aria-label={t('New tag')}
            data-tag-new=""
            onClick={() => onOpenPrompt('create')}
          >
            <MorphIcon icon={Tag} size={12} strokeWidth={1.75} />
            <span className="max-sm:hidden">{t('New tag')}</span>
          </Button>
        </span>
      </div>
    </div>
  )
}

function TagChip({ active, label, count, onClick, pick }: {
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
      data-tag-chip={pick}
    >
      {label}
      <span className={countCls}>{count}</span>
    </button>
  )
}

/** The detail dialog: usage count and store writes live with it, not the page. */
function PhotoDetailDialog({ photo, allTags, uses, onRequestDelete, onClose }: {
  photo: Photo | null
  allTags: string[]
  uses: Map<string, number>
  onRequestDelete: (id: string) => void
  onClose: () => void
}) {
  const tagPhoto = useStore(s => s.tagPhoto)
  const untagPhoto = useStore(s => s.untagPhoto)
  return (
    <PhotoDetail
      photo={photo}
      uses={photo ? uses.get(photo.id) ?? 0 : 0}
      allTags={allTags}
      onTag={tag => photo && tagPhoto(photo.id, tag)}
      onUntag={tag => photo && untagPhoto(photo.id, tag)}
      onDelete={() => photo && onRequestDelete(photo.id)}
      onClose={onClose}
    />
  )
}

/** The open name dialog: a new tag, or the one being renamed. */
interface TagPromptState {
  mode: 'create' | 'rename'
  seq: number
}

/**
 * The tag name dialog's state: `seq` makes every opening its own mount, so the
 * field starts from that opening's name, and a rename keeps its tag open while
 * a new tag leaves the view where it was.
 */
function useTagPrompt(tags: string[], pick: GroupPick, setPick: (pick: GroupPick) => void) {
  const t = useT()
  const addPhotoTag = useStore(s => s.addPhotoTag)
  const renamePhotoTag = useStore(s => s.renamePhotoTag)
  const [prompt, setPrompt] = useState<TagPromptState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = (mode: TagPromptState['mode']) => {
    setError(null)
    setPrompt(p => ({ mode, seq: (p?.seq ?? 0) + 1 }))
  }

  const close = () => {
    setPrompt(null)
    setError(null)
  }

  const submit = (name: string): boolean => {
    const res = prompt?.mode === 'rename'
      ? renameTag(tags, pick as string, name)
      : addTag(tags, name)
    if (!res.ok) {
      setError(res.reason === 'empty'
        ? t('Type a tag name')
        : res.reason === 'duplicate' ? t('A tag with that name already exists') : t('That tag no longer exists'))
      return false
    }
    const done = prompt?.mode === 'rename'
      ? renamePhotoTag(pick as string, name)
      : addPhotoTag(name)
    if (!done) {
      setError(t('That tag no longer exists'))
      return false
    }
    // A rename keeps its tag open; a new tag leaves the view where it was
    // (jumping into an empty tag hides the photos you just sorted).
    if (prompt?.mode === 'rename')
      setPick(res.name)
    setError(null)
    return true
  }

  return { prompt, error, open, close, submit }
}

function PhotoTagNamePrompt({ prompt, error, pick, onSubmit, onClose }: {
  prompt: TagPromptState | null
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
      title={prompt?.mode === 'rename' ? t('Rename tag') : t('New tag')}
      initial={prompt?.mode === 'rename' ? (pick ?? '') : ''}
      confirmLabel={prompt?.mode === 'rename' ? t('Rename') : t('Create')}
      error={error}
      field="tag"
      placeholder={t('Tag name')}
      maxLength={MAX_TAG_NAME}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}

/** Deleting a tag takes it off every photo that wears it; the photos stay. */
function PhotoTagDeleteDialog({ tag, onClose, onDeleted }: {
  tag: string | null
  onClose: () => void
  onDeleted: () => void
}) {
  const t = useT()
  const allPhotos = useStore(s => s.photos)
  const deletePhotoTag = useStore(s => s.deletePhotoTag)
  const photos = useMemo(() => photoAssetsOf(allPhotos), [allPhotos])
  const count = tag == null ? 0 : photos.filter(p => hasTag(p, tag)).length

  const confirm = () => {
    if (tag == null)
      return
    deletePhotoTag(tag)
    onDeleted()
    say(count
      ? t('Tag deleted · it came off every photo that wore it')
      : t('Tag deleted'))
  }

  return (
    <ConfirmDialog
      open={tag != null}
      title={t('Delete tag?')}
      description={count
        ? t('It comes off every photo that wears it. The photos themselves are not deleted.')
        : t('No photo wears this tag.')}
      confirmLabel={t('Delete tag')}
      danger
      onClose={onClose}
      onConfirm={confirm}
    />
  )
}

/** Deleting a photo leaves placed copies on the board: they stay as snapshots. */
function PhotoDeleteDialog({ photoId, onClose }: { photoId: string | null, onClose: () => void }) {
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
      ? t('Photo deleted · the copies placed on a board stay there')
      : t('Photo deleted'))
  }

  return (
    <ConfirmDialog
      open={photoId != null}
      title={t('Delete photo?')}
      description={placed > 0
        ? t('“{name}” leaves the library. The copies already placed on a board stay where they are and keep rendering in the preview and the export.', { name })
        : t('“{name}” leaves the library. It is not placed anywhere yet.', { name })}
      confirmLabel={t('Delete photo')}
      danger
      onClose={onClose}
      onConfirm={confirm}
    />
  )
}

/** What an empty grid says: no photos at all, or none under this filter or search. */
function PhotoEmptyState({ empty }: { empty: boolean }) {
  const t = useT()
  return (
    <p className="m-0 flex flex-col items-center gap-2 px-4 py-16 text-center text-[12px] leading-[1.6] text-dim" data-photo-empty="">
      <MorphIcon icon={Images} size={22} strokeWidth={1.5} className="text-faint" />
      {empty ? t('No photos here yet. Add them with the Add photos button above.') : t('No photos match this search or filter.')}
    </p>
  )
}
