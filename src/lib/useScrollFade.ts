import type { CSSProperties } from 'react'
import { useCallback } from 'react'

/**
 * Scroll-edge fade, following Base UI ScrollArea's "gradient scroll fade" pattern
 * (https://base-ui.com/react/components/scroll-area): the viewport exposes
 * --scroll-area-overflow-{x,y}-start / -end (px scrolled from each edge) and a CSS
 * mask ramps from transparent to black over min(fadeSize, overflow). We reproduce
 * the same vars on plain scroll containers (Select.List, grid, the tools dock row)
 * whose scrolling Base UI ScrollArea can't own. Measurements go straight to the
 * DOM (one per frame) so scrolling never re-renders React.
 *
 * A linear ramp is only an affordance where the content is a wall of ink. The
 * dock's row is a strip of transparent tool buttons (54–80px wide, icon and
 * caption centred): a ramp from 100% at 48px to 0 at the edge leaves the clipped
 * tool 20–60% opaque, which reads as a caption cut off mid-word, not as "more
 * tools this way". So the x band holds a clear gutter at the edge and then eases
 * in over the padding: the tool under the cut is gone, and what is left fading
 * is the one after it (see DESIGN.md: "the end that still hides tools fading out
 * as it goes").
 */
export type ScrollFadeAxis = 'x' | 'y'

function update(el: HTMLElement, axis: ScrollFadeAxis) {
  const pos = axis === 'x' ? el.scrollLeft : el.scrollTop
  const hidden = Math.max(0, axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight)
  const start = Math.min(Math.max(0, pos), hidden)
  const end = hidden - start
  el.style.setProperty(`--scroll-area-overflow-${axis}-start`, `${start < 1 ? 0 : start}px`)
  el.style.setProperty(`--scroll-area-overflow-${axis}-end`, `${end < 1 ? 0 : end}px`)
}

export function useScrollFade<T extends HTMLElement>(axis: ScrollFadeAxis = 'y') {
  // React 19 ref callback with cleanup return
  return useCallback((el: T | null) => {
    if (!el)
      return
    let frame = 0
    const measure = () => {
      frame = 0
      update(el, axis)
    }
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(measure)
    }
    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    // Box and content each resize on their own; either can create overflow.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild)
      ro.observe(el.firstElementChild)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [axis])
}

/** Band width per edge; the mask collapses to opaque once the overflow is under it. */
export const SCROLL_FADE = '48px'
/**
 * Share of the x band that stays fully clear at the edge. A tool clipped by the
 * row's edge is erased within it instead of showing half a caption.
 */
const GUTTER = 0.25
/**
 * The x ramp, as [fraction of the band, alpha] with the band measured inward
 * from its edge: an ease-in, so the ink right at the cut is nearly gone and the
 * band resolves into full opacity well inside the next tool.
 */
const RAMP = [[0.45, 0.07], [0.65, 0.28], [0.85, 0.64]] as const

/** The `linear-gradient(...)` a scroller of this axis masks itself with. */
export function fadeMask(axis: ScrollFadeAxis) {
  const dir = axis === 'x' ? 'to right' : 'to bottom'
  const v = `--scroll-area-overflow-${axis}`
  const band = (side: 'start' | 'end') => `min(${SCROLL_FADE}, var(${v}-${side}, 0px))`
  const lead = band('start')
  const tail = band('end')
  // y lists (the wrapped dock row, the label icon grids) are dense text rows: a
  // gutter would eat a whole line, so they keep the plain linear ramp.
  const stops = axis === 'y'
    ? ['transparent 0', `black ${lead}`, `black calc(100% - ${tail})`, 'transparent 100%']
    : [
        'transparent 0',
        `transparent calc(${lead} * ${GUTTER})`,
        ...RAMP.map(([at, alpha]) => `rgb(0 0 0 / ${alpha}) calc(${lead} * ${at})`),
        `black ${lead}`,
        `black calc(100% - ${tail})`,
        ...[...RAMP].reverse().map(([at, alpha]) => `rgb(0 0 0 / ${alpha}) calc(100% - ${tail} * ${at})`),
        `transparent calc(100% - ${tail} * ${GUTTER})`,
        'transparent 100%',
      ]
  return `linear-gradient(${dir}, ${stops.join(', ')})`
}
function fadeStyle(axis: ScrollFadeAxis): CSSProperties {
  const mask = fadeMask(axis)
  return { maskImage: mask, WebkitMaskImage: mask, maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }
}

/** Vertical fade (default); pair with useScrollFade() / useScrollFade('y'). */
export const scrollFadeStyle: CSSProperties = fadeStyle('y')
/** Horizontal fade; pair with useScrollFade('x'). */
export const scrollFadeStyleX: CSSProperties = fadeStyle('x')
