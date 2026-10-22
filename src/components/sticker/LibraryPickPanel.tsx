import type { Photo } from '../../lib/imageStore'
import { Images } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo } from 'react'
import { useT } from '../../lib/i18n'
import { paneAssetsOf } from '../../lib/stickerLibrary'
import { useStore } from '../../store'
import { Library } from '../Library'
import { Button } from '../ui/button'

/** No selection in a picker: one click is one pick, the rows stay clean. */
const NO_SELECTION: Set<string> = new Set()

/**
 * The sticker maker's other door, in library mode: draw the sticker from a
 * photo that is already imported. It stands in for the maker's stage rather
 * than over it, so the dialog keeps one modal, one stage height and one set of
 * effects below it.
 *
 * The thumbs are the photo drawer's own (`components/Library`, grid layout), so
 * a photo row never drifts between the two surfaces.
 */
export function LibraryPickPanel({ onPick, onCancel }: {
  onPick: (photo: Photo) => void
  onCancel: () => void
}) {
  const t = useT()
  const all = useStore(s => s.photos)
  const photos = useMemo(() => paneAssetsOf(all), [all])

  return (
    <div className="stage-clear relative flex h-[220px] shrink-0 flex-col overflow-hidden border border-line-strong" data-pick-library="">
      <div className="flex flex-none items-center gap-2 border-b border-line-strong bg-panel px-2 py-1">
        <MorphIcon icon={Images} size={13} strokeWidth={1.75} className="flex-none text-dim" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-txt">{t('Pick a photo')}</span>
        <Button variant="flat" data-pick-library-cancel="" onClick={onCancel}>{t('Cancel')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Library
          photos={photos}
          activeId={null}
          selectedIds={NO_SELECTION}
          layout="grid"
          onPick={(id) => {
            const photo = photos.find(p => p.id === id)
            if (photo)
              onPick(photo)
          }}
        />
      </div>
    </div>
  )
}
