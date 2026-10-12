import type { Photo } from '../lib/imageStore'
import { memo } from 'react'
import { useInView, useThumb } from '../hooks'
import { useT } from '../lib/i18n'

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
  const t = useT()

  return (
    <button
      ref={ref}
      type="button"
      className={`relative h-[72px] w-[108px] flex-none basis-[108px] cursor-pointer overflow-hidden rounded-none border-2 bg-thumb-bg p-0 opacity-82 transition-[opacity,border-color] duration-[120ms] hover:border-thumb-hover hover:opacity-100 ${active ? ' border-accent opacity-100' : ' border-transparent'}`}
      onClick={() => onPick(photo.id)}
      title={photo.name}
      data-size={size}
    >
      {url ? <img src={url} alt="" draggable={false} className="block h-full w-full object-cover" /> : <span className="block h-full w-full" />}
      {photo.videoFile && <span className="pointer-events-none absolute bottom-1 left-1 z-1 flex items-center gap-[3px] rounded-none bg-black/55 py-px pl-[3px] pr-1 text-[7.5px] font-bold tracking-[0.07em] text-white [&::before]:h-1.5 [&::before]:w-1.5 [&::before]:content-[''] [&::before]:rounded-full [&::before]:border [&::before]:border-current [&::before]:shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.55),inset_0_0_0_2.5px_#fff]" title={t('Live Photo')}>LIVE</span>}
    </button>
  )
})

export const Library = memo(({
  photos,
  activeId,
  onPick,
}: {
  photos: Photo[]
  activeId: string | null
  onPick: (id: string) => void
  layout?: 'row' | 'grid'
}) => {
  const t = useT()
  if (!photos.length) {
    return <p className="m-0 px-3.5 py-1 text-xs text-dim">{t('Library is empty. Click "+ Photo" or drop photos straight into the window.')}</p>
  }
  return (
    <div className="flex min-h-0 flex-1 items-start gap-[5px] overflow-x-auto overflow-y-hidden px-3.5 pb-1.5 [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb">
      {photos.map(p => (
        <Thumb key={p.id} photo={p} active={p.id === activeId} onPick={onPick} />
      ))}
    </div>
  )
})
