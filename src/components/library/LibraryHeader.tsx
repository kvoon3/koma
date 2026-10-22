import type { LibraryFilter, LibraryType } from '../../lib/library'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, ImagePlus, Search, WandSparkles } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useRef } from 'react'
import { useT } from '../../lib/i18n'
import { LIBRARY_KINDS } from '../../lib/library'
import { OVERVIEW_PATH } from '../../lib/routes'
import { useStore } from '../../store'
import { Button } from '../ui/button'
import { Tip } from '../ui/tip'
import { chipCls, chipOffCls, chipOnCls, countCls, toolCls } from './chips'

/**
 * The library's chrome: back, title, total, search and the two create doors on
 * one row, then the type chips. The search takes its own row on a phone, where
 * the buttons would otherwise squeeze it to nothing.
 */
export function LibraryHeader({
  total,
  filter,
  counts,
  query,
  onQueryChange,
  onFilterChange,
  onAddPhotos,
  onMakeSticker,
}: {
  total: number
  filter: LibraryFilter
  counts: Readonly<Record<LibraryType, number>>
  query: string
  onQueryChange: (query: string) => void
  onFilterChange: (filter: LibraryFilter) => void
  onAddPhotos: (files: File[]) => void
  onMakeSticker: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const back = () => {
    useStore.getState().clearSelection()
    // Opened from a board, back goes there; a direct URL has nothing behind
    // it, so it lands on the hub instead of leaving the app.
    if (router.history.length > 1)
      router.history.back()
    else
      void navigate({ to: OVERVIEW_PATH })
  }

  return (
    <header className="flex flex-none flex-col border-b border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 sm:px-4">
        <Tip
          label={t('Back')}
          trigger={(
            <button type="button" className={toolCls} aria-label={t('Back')} onClick={back} data-library-back="">
              <MorphIcon icon={ArrowLeft} size={15} strokeWidth={1.75} />
            </button>
          )}
        />
        <h1 className="m-0 text-[13.5px] font-semibold text-txt">{t('Library')}</h1>
        <span className="text-[11.5px] text-dim tabular-nums" data-library-total="">{total}</span>
        <span className="flex-1" />
        <label className="flex h-[26px] w-full min-w-0 items-center gap-1.5 border border-line-strong bg-panel-2 px-1.5 max-sm:order-last sm:w-[190px]">
          <MorphIcon icon={Search} size={12} strokeWidth={1.75} className="flex-none text-faint" />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-[11.5px] text-txt outline-0 placeholder:text-dim"
            value={query}
            placeholder={t('Search library')}
            aria-label={t('Search library')}
            data-library-search=""
            onChange={e => onQueryChange(e.target.value)}
          />
        </label>
        <span className="flex flex-none">
          <Button
            variant="strong"
            aria-label={t('Add photos')}
            data-library-add-photos=""
            onClick={() => fileRef.current?.click()}
          >
            <MorphIcon icon={ImagePlus} size={12} strokeWidth={1.75} />
            <span className="max-sm:hidden">{t('Add photos')}</span>
          </Button>
        </span>
        <span className="flex flex-none">
          <Button
            variant="strong"
            aria-label={t('New sticker')}
            data-library-new-sticker=""
            onClick={onMakeSticker}
          >
            <MorphIcon icon={WandSparkles} size={12} strokeWidth={1.75} />
            <span className="max-sm:hidden">{t('New sticker')}</span>
          </Button>
        </span>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif,.hif,.mov"
          multiple
          hidden
          data-library-file=""
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length)
              onAddPhotos(files)
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5 sm:px-4 sm:pb-2">
        <TypeChip active={filter === 'all'} label={t('All')} count={total} onClick={() => onFilterChange('all')} type="all" />
        {LIBRARY_KINDS.map(kind => (
          <TypeChip
            key={kind.type}
            active={filter === kind.type}
            label={t(kind.label)}
            count={counts[kind.type]}
            onClick={() => onFilterChange(kind.type)}
            type={kind.type}
          />
        ))}
      </div>
    </header>
  )
}

function TypeChip({ active, label, count, onClick, type }: {
  active: boolean
  label: string
  count: number
  onClick: () => void
  type: LibraryFilter
}) {
  return (
    <button
      type="button"
      className={`${chipCls} ${active ? chipOnCls : chipOffCls}`}
      aria-pressed={active}
      onClick={onClick}
      data-library-type={type}
    >
      {label}
      <span className={countCls}>{count}</span>
    </button>
  )
}
