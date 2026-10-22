import type { ComponentType } from 'react'
import type { GroupPick, LibraryFilter, LibrarySectionProps, LibraryType } from '../../lib/library'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useT } from '../../lib/i18n'
import { LIBRARY_KINDS, libraryAssets, libraryCounts, libraryTotal, livePick, validGroup } from '../../lib/library'
import { LIBRARY_PATH } from '../../lib/routes'
import { say } from '../../lib/toast'
import { useStore } from '../../store'
import { StickerMakerDialog } from '../StickerMakerDialog'
import { LibraryHeader } from './LibraryHeader'
import { MusicLibrarySection } from './MusicLibrarySection'
import { PhotoLibrarySection } from './PhotoLibrarySection'
import { StickerLibrarySection } from './StickerLibrarySection'

/**
 * The forcing function for a third kind: the record cannot be built unless
 * every row of `LIBRARY_KINDS` has a section component.
 */
const SECTIONS: Record<LibraryType, ComponentType<LibrarySectionProps>> = {
  photo: PhotoLibrarySection,
  sticker: StickerLibrarySection,
  music: MusicLibrarySection,
}

/**
 * `#/library`: photos and stickers on one page, split by the type chips. The
 * All view draws both grids without a group bar, so a tag or folder picked
 * earlier cannot narrow a grid it is no longer shown for (see `livePick`).
 */
export function LibraryPage() {
  const t = useT()
  const navigate = useNavigate()
  const { type } = useSearch({ from: LIBRARY_PATH })
  const filter: LibraryFilter = type ?? 'all'

  const allPhotos = useStore(s => s.photos)
  const tags = useStore(s => s.photoTags)
  const folders = useStore(s => s.stickerFolders)

  const assets = useMemo(() => libraryAssets(allPhotos), [allPhotos])
  const counts = useMemo(() => libraryCounts(assets), [assets])
  const total = libraryTotal(counts)

  const [query, setQuery] = useState('')
  const [tagPick, setTagPick] = useState<GroupPick>(null)
  const [folderPick, setFolderPick] = useState<GroupPick>(null)
  const [making, setMaking] = useState<{ seq: number } | null>(null)

  const setFilter = (next: LibraryFilter) => {
    void navigate({ to: LIBRARY_PATH, search: next === 'all' ? {} : { type: next }, replace: true })
  }

  const wiring: Record<LibraryType, { groups: string[], pick: GroupPick, onPick: (pick: GroupPick) => void }> = {
    photo: {
      groups: tags,
      pick: livePick(filter, 'photo', validGroup(tagPick, tags)),
      onPick: (next) => {
        setTagPick(next)
        // A card's tag click means "show me that tag", so the type follows it
        // even when the click came from the All view, where no tag bar is drawn.
        if (filter !== 'photo' && next != null)
          setFilter('photo')
      },
    },
    sticker: {
      groups: folders,
      pick: livePick(filter, 'sticker', validGroup(folderPick, folders)),
      onPick: setFolderPick,
    },
    // Music cards have no grouping; the empty wiring keeps the forcing record
    // complete without drawing a chip bar the section ignores.
    music: { groups: [], pick: null, onPick: () => {} },
  }

  const shownKinds = filter === 'all' ? LIBRARY_KINDS : LIBRARY_KINDS.filter(kind => kind.type === filter)
  const makerFolder = livePick(filter, 'sticker', validGroup(folderPick, folders)) ?? ''

  const onAddPhotos = (files: File[]) => {
    const created = useStore.getState().addPhotos(files, false)
    say(created.length ? t('Added {n} photos', { n: created.length }) : t('No image files found'))
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas" data-library="">
      <LibraryHeader
        total={total}
        filter={filter}
        counts={counts}
        query={query}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        onAddPhotos={onAddPhotos}
        onMakeSticker={() => setMaking(m => ({ seq: (m?.seq ?? 0) + 1 }))}
        onMakeMusicCard={() => useStore.getState().setMusicCardOpen(true)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-thumb]:bg-strip-thumb" data-library-scroll="">
        {shownKinds.map((kind) => {
          const Section = SECTIONS[kind.type]
          return (
            <Section
              key={kind.type}
              items={assets[kind.type]}
              groups={wiring[kind.type].groups}
              pick={wiring[kind.type].pick}
              onPick={wiring[kind.type].onPick}
              query={query}
              solo={filter === kind.type}
            />
          )
        })}
      </div>

      <StickerMakerDialog
        key={`make:${making?.seq ?? 0}`}
        open={making != null}
        target={making ? { kind: 'library', folder: makerFolder } : null}
        onClose={() => setMaking(null)}
      />
    </div>
  )
}
