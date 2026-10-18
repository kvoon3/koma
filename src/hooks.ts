import type { FilterId } from './lib/filters'
import type { Photo, Preview } from './lib/imageStore'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getFilteredPreview, peekFilteredPreview } from './lib/filterCache'
import { getPreview, getThumb, peekPreview, peekThumb } from './lib/imageStore'

export function usePreview(photo: Photo | null): Preview | null {
  const id = photo?.id ?? null
  const ref = useRef(photo)
  useEffect(
    () => { ref.current = photo },
    [photo],
  )
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

/**
 * The preview a pane should draw: the photo's plain preview, or the same photo
 * with its texture filter baked in (`lib/filterCache`).
 *
 * While a new filtered bitmap renders, the previous one stays on screen: it has
 * the same size and the same subject, so a filter switch reads as a change of
 * texture rather than a reload. It is only ever the *same photo's* previous
 * render; crossing photos falls back to the plain preview, never to another
 * photo's picture.
 */
export function usePanePreview(photo: Photo | null, filter: FilterId | undefined): Preview | null {
  const plain = usePreview(photo)
  const id = photo?.id ?? null
  // The base preview may not be decoded yet; when it lands, the filter can run.
  const plainUrl = plain?.url ?? null
  const photoRef = useRef(photo)
  useEffect(() => {
    photoRef.current = photo
  }, [photo])
  const [shown, setShown] = useState<{ photoId: string, preview: Preview } | null>(() => {
    const hit = id && filter ? peekFilteredPreview(id, filter) : null
    return hit && id ? { photoId: id, preview: hit } : null
  })

  useEffect(() => {
    const source = photoRef.current
    if (!id || !filter || !source) {
      setShown(null)
      return
    }
    const hit = peekFilteredPreview(id, filter)
    if (hit) {
      setShown({ photoId: id, preview: hit })
      return
    }
    setShown(held => (held && held.photoId === id ? held : null))
    let alive = true
    getFilteredPreview(source, filter).then((r) => {
      if (alive && r)
        setShown({ photoId: id, preview: r })
    })
    return () => {
      alive = false
    }
  }, [id, filter, plainUrl])

  if (!filter)
    return plain
  return shown && shown.photoId === id ? shown.preview : plain
}

export function useThumb(photo: Photo, visible: boolean): string | null {
  const id = photo.id
  const ref = useRef(photo)
  useEffect(
    () => { ref.current = photo },
    [photo],
  )
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

/**
 * Follow a CSS media query from React. For input traits (`pointer: coarse`) the
 * answer is fixed for a session, but reading it through a media query rather
 * than at mount keeps it correct when a hybrid device hands the page back and
 * forth between a finger and a mouse.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}
