import { displacementMapURL, glassBackdrop } from '../vendor/liquid-glass/liquid-glass'
import { supportsSvgBackdrop } from './dockBackground'

/**
 * Reusable liquid-glass refraction (vendored shuding/liquid-glass), as a
 * React 19 callback ref: `<X className="glass-liquid" ref={liquidGlassRef} />`.
 *
 * The `glass-liquid` utility (index.css) already renders blur + tint
 * everywhere. On engines that can refract (Chromium) this ref adds a filter
 * sized to the element: it measures with a ResizeObserver, mounts a uniquely
 * id'd `<filter>` into one shared hidden `<svg>`, and points the element's
 * `--glass-refract-filter` at it. The ref cleanup removes the filter, so a
 * filter only exists while its popup/dialog is mounted (open).
 */
const SVG_NS = 'http://www.w3.org/2000/svg'
/** Maps are generated at most this many px on the long side, then stretched. */
const MAP_MAX = 256
const mapCache = new Map<string, { href: string, scale: number }>()
let host: SVGSVGElement | null = null
let seq = 0

/** Pure: map resolution for an element size (bounded cost on big dialogs). */
export function mapSize(w: number, h: number): { mw: number, mh: number, k: number } {
  const k = Math.max(1, Math.max(w, h) / MAP_MAX)
  return { mw: Math.max(1, Math.round(w / k)), mh: Math.max(1, Math.round(h / k)), k }
}

function cachedMap(mw: number, mh: number) {
  const key = `${mw}x${mh}`
  let m = mapCache.get(key)
  if (!m) {
    m = displacementMapURL(mw, mh)
    if (mapCache.size > 32)
      mapCache.clear()
    mapCache.set(key, m)
  }
  return m
}

function svgHost(): SVGSVGElement {
  if (host?.isConnected)
    return host
  host = document.createElementNS(SVG_NS, 'svg')
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('width', '0')
  host.setAttribute('height', '0')
  host.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none'
  host.dataset.liquidGlassHost = ''
  document.body.appendChild(host)
  return host
}

const canRefract = typeof window !== 'undefined' && supportsSvgBackdrop()

export function liquidGlassRef(el: HTMLElement | null): void | (() => void) {
  if (!el || !canRefract)
    return
  const id = `koma-lg-${++seq}`
  const filter = document.createElementNS(SVG_NS, 'filter')
  filter.id = id
  filter.setAttribute('filterUnits', 'userSpaceOnUse')
  filter.setAttribute('color-interpolation-filters', 'sRGB')
  filter.setAttribute('x', '0')
  filter.setAttribute('y', '0')
  const img = document.createElementNS(SVG_NS, 'feImage')
  img.setAttribute('preserveAspectRatio', 'none')
  img.setAttribute('result', 'map')
  const disp = document.createElementNS(SVG_NS, 'feDisplacementMap')
  disp.setAttribute('in', 'SourceGraphic')
  disp.setAttribute('in2', 'map')
  disp.setAttribute('xChannelSelector', 'R')
  disp.setAttribute('yChannelSelector', 'G')
  filter.append(img, disp)
  svgHost().appendChild(filter)

  let last = ''
  const update = () => {
    // Layout size: ignores the open/close scale transform.
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (!w || !h || `${w}x${h}` === last)
      return
    last = `${w}x${h}`
    const { mw, mh, k } = mapSize(w, h)
    const map = cachedMap(mw, mh)
    for (const n of [filter, img]) {
      n.setAttribute('width', String(w))
      n.setAttribute('height', String(h))
    }
    img.setAttribute('href', map.href)
    disp.setAttribute('scale', String(map.scale * k))
  }
  const ro = new ResizeObserver(update)
  ro.observe(el)
  update()
  el.style.setProperty('--glass-refract-filter', glassBackdrop(id))
  el.dataset.liquidGlass = id
  return () => {
    ro.disconnect()
    filter.remove()
    el.style.removeProperty('--glass-refract-filter')
    delete el.dataset.liquidGlass
  }
}
