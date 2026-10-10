import type { Photo } from '../lib/imageStore'
import { memo } from 'react'
import { useInView, useThumb } from '../hooks'

export const Thumb = memo(({
  photo,
  active,
  onPick,
  size = 220,
}: {
  photo: Photo
  active: boolean
  onPick: (id: string) => void
  size?: number
}) => {
  const [ref, seen] = useInView<HTMLButtonElement>('260px')
  const url = useThumb(photo, seen)

  return (
    <button
      ref={ref}
      type="button"
      className={`thumb${active ? ' on' : ''}`}
      onClick={() => onPick(photo.id)}
      title={photo.name}
      data-size={size}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <span className="ph" />}
      {photo.videoFile && <span className="liveBadge" title="Live Photo">LIVE</span>}
    </button>
  )
})

export const Library = memo(({
  photos,
  activeId,
  onPick,
  layout = 'row',
}: {
  photos: Photo[]
  activeId: string | null
  onPick: (id: string) => void
  layout?: 'row' | 'grid'
}) => {
  if (!photos.length) {
    return <p className="hint dim">Library is empty. Click "+ Photo" or drop photos straight into the window.</p>
  }
  return (
    <div className={`strip ${layout}`}>
      {photos.map(p => (
        <Thumb key={p.id} photo={p} active={p.id === activeId} onPick={onPick} />
      ))}
    </div>
  )
})
