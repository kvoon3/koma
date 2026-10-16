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

const FADE = '48px'
function fadeMask(axis: ScrollFadeAxis) {
  const dir = axis === 'x' ? 'to right' : 'to bottom'
  const v = `--scroll-area-overflow-${axis}`
  return `linear-gradient(${dir}, transparent 0, black min(${FADE}, var(${v}-start, 0px)), black calc(100% - min(${FADE}, var(${v}-end, 0px))), transparent 100%)`
}
function fadeStyle(axis: ScrollFadeAxis): CSSProperties {
  const mask = fadeMask(axis)
  return { maskImage: mask, WebkitMaskImage: mask, maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }
}

/** Vertical fade (default); pair with useScrollFade() / useScrollFade('y'). */
export const scrollFadeStyle: CSSProperties = fadeStyle('y')
/** Horizontal fade; pair with useScrollFade('x'). */
export const scrollFadeStyleX: CSSProperties = fadeStyle('x')
