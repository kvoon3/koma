import type { CSSProperties } from 'react'
import { useCallback } from 'react'

/**
 * Scroll-edge fade, following Base UI ScrollArea's "gradient scroll fade" pattern
 * (https://base-ui.com/react/components/scroll-area): the viewport exposes
 * --scroll-area-overflow-y-start / -end (px scrolled from each edge) and a CSS
 * mask ramps from transparent to black over min(fadeSize, overflow). We reproduce
 * the same vars on plain scroll containers (Select.List, grid) whose scrolling
 * Base UI ScrollArea can't own.
 */
function update(el: HTMLElement) {
  const start = Math.max(0, el.scrollTop)
  const end = Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop)
  el.style.setProperty('--scroll-area-overflow-y-start', `${start}px`)
  el.style.setProperty('--scroll-area-overflow-y-end', `${end < 1 ? 0 : end}px`)
}

export function useScrollFade<T extends HTMLElement>() {
  // React 19 ref callback with cleanup return
  return useCallback((el: T | null) => {
    if (!el)
      return
    update(el)
    const onScroll = () => update(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])
}

const FADE = '48px'
export const scrollFadeStyle: CSSProperties = {
  maskImage: `linear-gradient(to bottom, transparent 0, black min(${FADE}, var(--scroll-area-overflow-y-start, 0px)), black calc(100% - min(${FADE}, var(--scroll-area-overflow-y-end, ${FADE}))), transparent 100%)`,
  WebkitMaskImage: `linear-gradient(to bottom, transparent 0, black min(${FADE}, var(--scroll-area-overflow-y-start, 0px)), black calc(100% - min(${FADE}, var(--scroll-area-overflow-y-end, ${FADE}))), transparent 100%)`,
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
}
