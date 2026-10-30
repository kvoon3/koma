import type { BoardCell } from '../../lib/boardPreview'
import type { Photo } from '../../lib/imageStore'
import { useState } from 'react'
import { usePreview } from '../../hooks'
import { wallpaperPhotoIds } from '../../lib/boardPreview'

/**
 * The page's blurred board wallpaper: one large tile per photo the board shows
 * at the moment the page opened. It stays put while the page switches groups,
 * so the page reads as one room and the cards move inside it.
 */
export function GroupWallpaper({ board, photoById }: { board: readonly BoardCell[], photoById: Map<string, Photo> }) {
  const [ids] = useState(() => wallpaperPhotoIds(board))
  if (!ids.length)
    return null
  return (
    <div aria-hidden data-group-wallpaper="" className="wallpaper-in pointer-events-none absolute inset-0 overflow-hidden bg-panel-2">
      <div className="absolute inset-0 grid scale-110 grid-cols-3 grid-rows-3 opacity-50 blur-2xl">
        {ids.map(id => <WallpaperTile key={id} photo={photoById.get(id) ?? null} />)}
      </div>
    </div>
  )
}

/** One blurred photo tile: the photo's cached preview, cover-fitted. */
function WallpaperTile({ photo }: { photo: Photo | null }) {
  const preview = usePreview(photo)
  return (
    <div className="relative overflow-hidden bg-panel-2">
      {preview
        ? <img src={preview.url} alt="" draggable={false} className="h-full w-full object-cover" />
        : null}
    </div>
  )
}
