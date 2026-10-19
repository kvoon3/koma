import type { FilterValue } from './lib/filters'
import type { Photo, Preview } from './lib/imageStore'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getFilteredPreview, peekFilteredPreview } from './lib/filterCache'
import { filterKey, resolveFilter } from './lib/filters'
import { getPreview, getThumb, peekPreview, peekThumb } from './lib/imageStore'
import { referenceCounts } from './lib/stickerLibrary'
import { useStore } from './store'

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
 *
 * The filter is a value (`FilterValue`), so the render is keyed by its whole
 * setting (`filterKey`): turning the mosaic's block dial re-renders, and
 * `leaf.filter`'s object identity changing on an unrelated patch does not.
 */
export function usePanePreview(photo: Photo | null, filter: FilterValue | undefined): Preview | null {
  const plain = usePreview(photo)
  const id = photo?.id ?? null
  // The base preview may not be decoded yet; when it lands, the filter can run.
  const plainUrl = plain?.url ?? null
  const photoRef = useRef(photo)
  const filterRef = useRef(filter)
  const key = filterKey(filter)
  const keyRef = useRef(key)
  useEffect(() => {
    photoRef.current = photo
    filterRef.current = filter
    keyRef.current = key
  }, [photo, filter, key])
  const [shown, setShown] = useState<{ photoId: string, preview: Preview } | null>(() => {
    const hit = id && key !== 'none' ? peekFilteredPreview(id, filter) : null
    return hit && id ? { photoId: id, preview: hit } : null
  })

  useEffect(() => {
    const source = photoRef.current
    const spec = resolveFilter(filterRef.current)
    if (!id || !spec || !source) {
      setShown(null)
      return
    }
    const hit = peekFilteredPreview(id, spec)
    if (hit) {
      setShown({ photoId: id, preview: hit })
      return
    }
    setShown(held => (held && held.photoId === id ? held : null))
    let alive = true
    getFilteredPreview(source, spec).then((r) => {
      // A late render from an older setting must not replace the current one.
      if (alive && r && keyRef.current === key)
        setShown({ photoId: id, preview: r })
    })
    return () => {
      alive = false
    }
  }, [id, key, plainUrl])

  if (key === 'none')
    return plain
  // Still the same photo: keep its last filtered bitmap up while the new one
  // renders, so dialling a knob does not flash the unfiltered photo.
  return shown && shown.photoId === id ? shown.preview : plain
}

/**
 * Photo id → how many places the app draws it: every board of every group
 * (pane photos, pane stickers, board stickers) plus the collage background.
 * One derivation for both library pages (photo management and stickers), so a
 * usage badge cannot drift between them; the count is never stored (see
 * `lib/stickerLibrary.referenceCounts`).
 */
export function useAssetUses(): Map<string, number> {
  const workspaces = useStore(s => s.workspaces)
  const parkedBoards = useStore(s => s.parkedBoards)
  const bgImage = useStore(s => s.bgImage)
  return useMemo(
    () => referenceCounts(
      [...workspaces, ...Object.values(parkedBoards).flatMap(b => b.workspaces)],
      [bgImage?.photoId],
    ),
    [workspaces, parkedBoards, bgImage],
  )
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

/**
 * The tools sheet's top edge in viewport px, or null while no sheet is mounted.
 *
 * The sheet is a fixed overlay with no put-away state (`lib/toolsDockMode`), and
 * a tall canvas keeps running underneath it, so the bottom of the stage (a
 * pane's bottom-right corner with it) can sit behind the sheet's glass. Board
 * chrome that pins itself to a pane's bottom edge reads this to lift itself over
 * the sheet instead.
 *
 * Observed, not read once: the sheet is a sibling of the stage, so nothing
 * would re-render the board when it moves. Its display rides a spring, which
 * moves the sheet without ever resizing its box (the box is the tallest
 * display's, the position is a transform), so a resize observer alone misses a
 * display change: the style the spring writes is watched too, and the edge is
 * read once per frame at most.
 */
export function useToolsSheetTop(): number | null {
  const [top, setTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    const sheet = document.querySelector('[data-dock-mode]')
    if (!sheet)
      return
    let frame = 0
    const read = () => {
      frame = 0
      const next = sheet.getBoundingClientRect().top
      setTop(prev => (prev != null && Math.abs(prev - next) < 0.5 ? prev : next))
    }
    const queue = () => {
      if (!frame)
        frame = requestAnimationFrame(read)
    }
    const mo = new MutationObserver(queue)
    mo.observe(sheet, { attributes: true, attributeFilter: ['style', 'data-dock-mode'] })
    const ro = new ResizeObserver(queue)
    ro.observe(sheet)
    window.addEventListener('resize', queue)
    queue()
    return () => {
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', queue)
      if (frame)
        cancelAnimationFrame(frame)
    }
  }, [])

  return top
}
