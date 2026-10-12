import type { Photo, Preview } from './lib/imageStore'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getPreview, getThumb, peekPreview, peekThumb } from './lib/imageStore'

export function usePreview(photo: Photo | null): Preview | null {
  const id = photo?.id ?? null
  const ref = useRef(photo)
  ref.current = photo
  const [url, setUrl] = useState<Preview | null>(() => (id ? peekPreview(id) : null))

  useEffect(() => {
    const ph = ref.current
    if (!id || !ph) {
      setUrl(null)
      return
    }
    const cached = peekPreview(id)
    if (cached) {
      setUrl(cached)
      return
    }
    setUrl(null)
    let alive = true
    getPreview(ph).then((r) => {
      if (alive && r)
        setUrl(r)
    })
    return () => {
      alive = false
    }
  }, [id])

  return url
}

export function useThumb(photo: Photo, visible: boolean): string | null {
  const id = photo.id
  const ref = useRef(photo)
  ref.current = photo
  const [url, setUrl] = useState<string | null>(() => peekThumb(id))

  useEffect(() => {
    if (!visible)
      return
    let alive = true
    getThumb(ref.current).then((u) => {
      if (alive && u)
        setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [id, visible])

  return url
}

/** True on touch-primary devices — the JS twin of the `pointer-coarse` CSS variant. */
export function useCoarse() {
  const [coarse, setCoarse] = useState(() => matchMedia('(pointer: coarse)').matches)
  useEffect(() => {
    const mq = matchMedia('(pointer: coarse)')
    const on = () => setCoarse(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return coarse
}

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el)
      return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, size] as const
}

export function useInView<T extends HTMLElement>(rootMargin = '200px') {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || seen)
      return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, rootMargin])

  return [ref, seen] as const
}
