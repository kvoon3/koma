import type { Photo, Preview } from './lib/imageStore'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/**
 * End-fade lengths for a scroller that runs sideways: how much content is
 * hidden past each end, written to `--scroll-overflow-start` / `-end` for the
 * `.scroll-fade` mask (index.css). The measurements go straight to the DOM
 * rather than through state on purpose: the tools row sits under the whole
 * canvas, and re-rendering that per scroll frame would be absurd. Handed back
 * as a callback ref because the row mounts only once a pane holds a photo.
 */
export function useScrollFade<T extends HTMLElement>() {
  return useCallback((el: T | null) => {
    if (!el)
      return
    let frame = 0
    const measure = () => {
      frame = 0
      const hidden = Math.max(0, el.scrollWidth - el.clientWidth)
      const past = Math.min(Math.max(el.scrollLeft, 0), hidden)
      el.style.setProperty('--scroll-overflow-start', `${past}px`)
      el.style.setProperty('--scroll-overflow-end', `${hidden - past}px`)
    }
    // One measurement per frame, however many scroll events a finger fires.
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(measure)
    }
    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    // Box and row each change size on their own, and either one can be the one
    // that makes the row overflow.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const row = el.firstElementChild
    if (row)
      ro.observe(row)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])
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
