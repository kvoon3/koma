import type { Photo } from '../lib/imageStore'
import { Check } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { memo, useEffect, useRef } from 'react'
import { useInView, useThumb } from '../hooks'
import { useT } from '../lib/i18n'

/** Modifier state of a thumbnail click, resolved by the drawer into a selection op. */
export interface PickMods {
  toggle: boolean
  range: boolean
}

// How long a pointer must stay down before it counts as a selection long-press.
const LONG_PRESS_MS = 450
// A pointer that travels more than this is a scroll / drag, not a hold.
const LONG_PRESS_SLOP = 10

export const Thumb = memo(({
  photo,
  active,
  selected,
  onPick,
  size = 220,
}: {
  photo: Photo
  active: boolean
  selected: boolean
  onPick: (id: string, mods: PickMods) => void
  size?: number
}) => {
  const [ref, seen] = useInView<HTMLButtonElement>('260px')
  const url = useThumb(photo, seen)
  const t = useT()
  const holdRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number, y: number } | null>(null)
  // Set when a long-press just toggled selection: the click that follows the
  // release must not also assign the photo, so swallow it once.
  const firedRef = useRef(false)

  const cancelHold = () => {
    if (holdRef.current != null) {
      window.clearTimeout(holdRef.current)
      holdRef.current = null
    }
    startRef.current = null
  }

  // A thumbnail can unmount mid-hold (library cleared): drop the pending timer.
  useEffect(() => () => {
    if (holdRef.current != null)
      window.clearTimeout(holdRef.current)
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      className={`relative h-[72px] w-[108px] flex-none basis-[108px] cursor-pointer overflow-hidden rounded-none border-2 bg-thumb-bg p-0 opacity-82 transition-[opacity,border-color] duration-[120ms] hover:border-thumb-hover hover:opacity-100 select-none [-webkit-touch-callout:none] ${selected || active ? ' border-accent opacity-100' : ' border-transparent'}`}
      onPointerDown={(e) => {
        startRef.current = { x: e.clientX, y: e.clientY }
        firedRef.current = false
        holdRef.current = window.setTimeout(() => {
          firedRef.current = true
          onPick(photo.id, { toggle: true, range: false })
        }, LONG_PRESS_MS)
      }}
      onPointerMove={(e) => {
        const s = startRef.current
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP)
          cancelHold()
      }}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onClick={(e) => {
        if (firedRef.current) {
          firedRef.current = false
          return
        }
        onPick(photo.id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey })
      }}
      title={photo.name}
      data-size={size}
    >
      {url ? <img src={url} alt="" draggable={false} className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" /> : <span className="block h-full w-full" />}
      {selected && (
        // Same corner-badge treatment as the LIVE tag, so a batch selection
        // reads apart from the single active photo while sharing its border.
        <span className="pointer-events-none absolute right-1 top-1 z-1 grid h-4 w-4 place-items-center rounded-none bg-accent text-on-accent">
          <MorphIcon icon={Check} size={11} strokeWidth={2.5} />
        </span>
      )}
      {photo.videoFile && <span className="pointer-events-none absolute bottom-1 left-1 z-1 flex items-center gap-[3px] rounded-none bg-black/55 py-px pl-[3px] pr-1 text-[7.5px] font-bold tracking-[0.07em] text-white [&::before]:h-1.5 [&::before]:w-1.5 [&::before]:content-[''] [&::before]:rounded-full [&::before]:border [&::before]:border-current [&::before]:shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.55),inset_0_0_0_2.5px_#fff]" title={t('Live Photo')}>LIVE</span>}
    </button>
  )
})

export const Library = memo(({
  photos,
  activeId,
  selectedIds,
  onPick,
}: {
  photos: Photo[]
  activeId: string | null
  selectedIds: Set<string>
  onPick: (id: string, mods: PickMods) => void
  layout?: 'row' | 'grid'
}) => {
  const t = useT()
  if (!photos.length) {
    return <p className="m-0 px-3.5 py-1 text-xs text-dim">{t('Library is empty. Click "+ Photo" or drop photos straight into the window.')}</p>
  }
  return (
    <div className="flex min-h-0 flex-1 items-start gap-[5px] overflow-x-auto overflow-y-hidden px-3.5 pb-1.5 [&::-webkit-scrollbar]:h-[9px] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:bg-strip-thumb">
      {photos.map(p => (
        <Thumb key={p.id} photo={p} active={p.id === activeId} selected={selectedIds.has(p.id)} onPick={onPick} />
      ))}
    </div>
  )
})
