import type { FilterValue } from './lib/filters'
import type { Photo, Preview } from './lib/imageStore'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { clampViewScale, viewWheelFactor, wheelNotches } from './lib/canvasView'
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

/**
 * A live element box: `w`/`h` are the client size, `top` the viewport Y of the
 * box's top edge. Seating content against chrome that overlays the element
 * (the tools sheet over the stage) needs both the size and where it starts.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0, top: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el)
      return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight, top: el.getBoundingClientRect().top })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, size] as const
}

/**
 * The stage's wheel on the air around the canvas, and the working view zoom
 * (see `lib/canvasView`): the live scale, the double-click fit, and the two
 * wheel paths.
 *
 * A **plain wheel** on the air sizes the canvas itself, through
 * `onWheelResize` (one notch is 1.1×, as a signed count). That is what the air
 * belongs to: it is outside the canvas, so the wheel there acts on the canvas
 * object, and the canvas size is the one value this lane already has a control
 * for (the rail's canvas line drives the same field). A **ctrl/meta + wheel**
 * (a trackpad pinch, which arrives as one) still scales the view about the
 * canvas's centre, so inspecting the board at 2× is still a gesture away.
 *
 * Both only act outside the canvas element, so the board keeps every gesture it
 * had: a wheel over a photo is that pane's photo zoom, and a plain wheel over the
 * rail steps whatever the rail is sizing (`onWheelResize` leaves the rail's own
 * wheel alone: the rail marks it, and the guard here honours that).
 * `enabled` lets a surface hand the stage back (the overview's switcher owns it
 * while it is open), and a stage with no canvas to size (the overview's column)
 * passes no `onWheelResize` and keeps the wheel on the view.
 */
export function useStageZoom(
  stageRef: React.RefObject<HTMLElement | null>,
  canvasRef: React.RefObject<HTMLElement | null>,
  { enabled = true, onWheelResize, fitCanvas }: {
    enabled?: boolean
    /** A plain wheel on the air, in notches (up is positive). */
    onWheelResize?: (notches: number) => void
    /** A double-click on the air puts the canvas back to the fit as well. */
    fitCanvas?: () => void
  } = {},
) {
  const [scale, setScale] = useState(1)
  // The listener binds once; the gesture reads the live value from here.
  const scaleRef = useRef(1)
  const apply = useCallback((next: number) => {
    scaleRef.current = next
    setScale(next)
  }, [])
  const fit = useCallback(() => apply(1), [apply])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !enabled)
      return
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || canvasRef.current?.contains(e.target as Node))
        return
      const pinch = e.ctrlKey || e.metaKey
      // The rail owns a plain wheel over itself: it steps what it is sizing.
      if (!pinch && (e.target as Element | null)?.closest?.('[role="slider"]'))
        return
      // The air is ours: never let the browser zoom or scroll the page instead.
      e.preventDefault()
      if (onWheelResize && !pinch) {
        onWheelResize(wheelNotches(e.deltaY))
        return
      }
      apply(clampViewScale(scaleRef.current * viewWheelFactor(e.deltaY, pinch)))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [stageRef, canvasRef, enabled, apply, onWheelResize])

  /** A double-click on the air (never on the canvas itself) puts the stage back. */
  const onStageDoubleClick = useCallback((e: React.MouseEvent) => {
    if (canvasRef.current?.contains(e.target as Node))
      return
    fit()
    fitCanvas?.()
  }, [canvasRef, fit, fitCanvas])

  return { scale, fit, onStageDoubleClick }
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
 * An edge of a piece of chrome that floats over the stage, in viewport px, or
 * null while it is not mounted.
 *
 * Observed, not read once: floating chrome is a sibling of the stage (or an
 * overlay over it), so nothing would re-render the board when it moves. Its
 * display rides a spring, which moves it without ever resizing its box (the box
 * is the tallest display's, the position is a transform), so a resize observer
 * alone misses a display change: the style the spring writes is watched too, and
 * the edge is read once per frame at most.
 */
function useChromeEdge(selector: string, edge: 'top' | 'bottom'): number | null {
  const [at, setAt] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = document.querySelector(selector)
    if (!el)
      return
    let frame = 0
    const read = () => {
      frame = 0
      const rect = el.getBoundingClientRect()
      const next = edge === 'top' ? rect.top : rect.bottom
      setAt(prev => (prev != null && Math.abs(prev - next) < 0.5 ? prev : next))
    }
    const queue = () => {
      if (!frame)
        frame = requestAnimationFrame(read)
    }
    const mo = new MutationObserver(queue)
    mo.observe(el, { attributes: true, attributeFilter: ['style', 'data-dock-mode'] })
    const ro = new ResizeObserver(queue)
    ro.observe(el)
    window.addEventListener('resize', queue)
    queue()
    return () => {
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', queue)
      if (frame)
        cancelAnimationFrame(frame)
    }
  }, [selector, edge])

  return at
}

/**
 * The tools sheet's top edge in viewport px, or null while no sheet is mounted.
 *
 * The sheet is a fixed overlay with no put-away state (`lib/toolsDockMode`), and
 * a tall canvas keeps running underneath it, so the bottom of the stage (a
 * pane's bottom-right corner with it) can sit behind the sheet's glass. Board
 * chrome that pins itself to a pane's bottom edge reads this to lift itself over
 * the sheet instead.
 */
export function useToolsSheetTop(): number | null {
  return useChromeEdge('[data-dock-mode]', 'top')
}

/**
 * The bottom edge of the stage's top-right action cluster (undo / redo /
 * history / reset), in viewport px. The rail's top is the other end of the same
 * problem the sheet poses at the bottom: a short stage has no room above it, so
 * its scale has to start below the buttons instead of running behind them.
 */
export function useFloatingActionsBottom(): number | null {
  return useChromeEdge('[data-float-actions]', 'bottom')
}

/** The boxes a stage-seated chip derives its seat from, in viewport px. */
export interface DockSeatBoxes {
  /** The tools sheet's top-left corner. */
  dock: { left: number, top: number }
  /** The host the chip is portalled into (the stage). */
  stage: { left: number, bottom: number }
}

/**
 * The tools sheet's top-left corner and the stage's box, for a chip that seats
 * itself against the sheet. Both are measured rather than derived (the sheet is
 * a fixed overlay whose seat changes with every display it cycles through and
 * with a drag), and the host is watched too, since a layout change moves the
 * stage under the sheet. Null until both are mounted.
 */
export function useDockSeatBoxes(host: HTMLElement | null): DockSeatBoxes | null {
  // The host is part of the state so a second stage never reads the first one's
  // boxes while its own first read is still queued.
  const [measured, setMeasured] = useState<{ host: HTMLElement, boxes: DockSeatBoxes } | null>(null)

  useLayoutEffect(() => {
    const dock = document.querySelector<HTMLElement>('[data-dock-mode]')
    if (!host || !dock)
      return
    let frame = 0
    const measure = () => {
      frame = 0
      const d = dock.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      const next = { dock: { left: d.left, top: d.top }, stage: { left: h.left, bottom: h.bottom } }
      setMeasured(prev => prev?.host === host
        && Math.abs(prev.boxes.dock.left - next.dock.left) < 0.5
        && Math.abs(prev.boxes.dock.top - next.dock.top) < 0.5
        && Math.abs(prev.boxes.stage.left - next.stage.left) < 0.5
        && Math.abs(prev.boxes.stage.bottom - next.stage.bottom) < 0.5
        ? prev
        : { host, boxes: next })
    }
    const queue = () => {
      if (!frame)
        frame = requestAnimationFrame(measure)
    }
    // The first read is queued like the rest: until it lands the chip renders
    // nothing, never a seat at the origin.
    const mo = new MutationObserver(queue)
    mo.observe(dock, { attributes: true, attributeFilter: ['style', 'data-dock-mode'] })
    const ro = new ResizeObserver(queue)
    ro.observe(dock)
    ro.observe(host)
    window.addEventListener('resize', queue)
    queue()
    return () => {
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', queue)
      if (frame)
        cancelAnimationFrame(frame)
    }
  }, [host])

  return measured?.host === host ? measured.boxes : null
}
