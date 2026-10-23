/**
 * The board's rect → DOM mapping, in one place.
 *
 * A divider drag changes every pane's rect on every frame. Rendering that
 * through React costs a whole phone frame (the store, the tree, the canvas
 * menu), while the browser's own layout of it is nearly free: panes are
 * absolutely positioned, so moving one reflows nothing. So the drag writes the
 * same numbers straight onto the DOM and commits once, on release.
 *
 * The risk in that is drift: two maps of "where a pane sits" that disagree.
 * Hence this module. React's JSX and `paintBoard` both read the styles from
 * here, and `paneDraws` is the single derivation of a pane's drawn box, so a
 * painted frame and a rendered frame are the same frame by construction.
 */
import type { Derived } from './layout'
import type { Divider, Leaf, Rect, SeamSides } from './panes'
import { blendFadePx, dividerLine, expandRectForBlend, placement } from './panes'

/** One pane as the stage draws it: its cell, its drawn box, and the fade beside it. */
export interface PaneDraw {
  leaf: Leaf
  /** The layout cell: what the photo is placed against. */
  rect: Rect
  /** What the pane's box is drawn at (grown into seams by the crossfade). */
  draw: Rect
  /** Edge-feather width for this pane; 0 for an empty one under crossfade. */
  fade: number
  /** Which of this pane's edges face another photo, for its feather mask. */
  seam: SeamSides | undefined
}

/**
 * Every pane's drawn box for a layout. Pure: the stage maps this into `<Pane>`
 * props and `paintBoard` maps it into inline styles, so the two agree.
 */
export function paneDraws(
  view: Derived,
  seams: Map<string, SeamSides>,
  crossfade: boolean,
  paneFade: number,
  fadeStrength: number,
): PaneDraw[] {
  // Crossfade pairs neighbours inside one photo-photo seam, so the fade is the
  // blended width; the plain path uses the edge fade as it is.
  const fade = crossfade ? blendFadePx(paneFade, fadeStrength, view.gap) : paneFade
  return view.leaves.map(({ node, rect }) => {
    const seam = seams.get(node.id)
    return {
      leaf: node,
      rect,
      draw: crossfade && node.photoId ? expandRectForBlend(rect, seam, fade) : rect,
      fade: crossfade && !node.photoId ? 0 : fade,
      seam,
    }
  })
}

/** A pane's box on the canvas, exactly as `<Pane>` styles it. */
export function paneBoxStyle(draw: Rect): { left: number, top: number, width: number, height: number } {
  return { left: draw.x, top: draw.y, width: draw.w, height: draw.h }
}

/**
 * The photo's transform inside its pane. `placement` is measured from the
 * layout cell, so the offset is against the drawn box (they differ only under
 * the crossfade).
 */
export function transformOf(p: { x: number, y: number, scale: number }, draw: Rect): string {
  return `translate(${p.x - draw.x}px, ${p.y - draw.y}px) scale(${p.scale})`
}

/** `transformOf` from the placement inputs, for callers that have no placement. */
export function photoTransform(cell: Rect, draw: Rect, leaf: Leaf, iw: number, ih: number): string | null {
  if (!iw || !ih)
    return null
  return transformOf(placement(cell, leaf, iw, ih), draw)
}

/** The placed photo's box in pane-local px: what a Live Photo video fills. */
export function photoBoxStyle(cell: Rect, draw: Rect, leaf: Leaf, iw: number, ih: number) {
  const p = placement(cell, leaf, iw, ih)
  return { left: p.x - draw.x, top: p.y - draw.y, width: p.w, height: p.h }
}

/** The minimap's window onto the photo, as photo fractions. */
export interface MinimapView {
  x: number
  y: number
  w: number
  h: number
}

/** The window as photo fractions: placement inverted. */
export function minimapView(cell: Rect, draw: Rect, leaf: Leaf, iw: number, ih: number): MinimapView {
  const p = placement(cell, leaf, iw, ih)
  return {
    x: Math.max(0, (draw.x - p.x) / p.w),
    y: Math.max(0, (draw.y - p.y) / p.h),
    w: Math.min(1, draw.w / p.w),
    h: Math.min(1, draw.h / p.h),
  }
}

/**
 * The minimap's two boxes: the window onto the photo, and where it sits in it.
 * `limitH` clamps the window's bottom in pane-local px, which is how the chip
 * stays clear of the tools sheet.
 */
export function minimapStyles(cell: Rect, draw: Rect, leaf: Leaf, iw: number, ih: number, limitH?: number) {
  const p = placement(cell, leaf, iw, ih)
  const l = Math.max(0, p.x - draw.x)
  const t = Math.max(0, p.y - draw.y)
  return {
    box: {
      left: l,
      top: t,
      width: Math.max(0, Math.min(draw.w, p.x - draw.x + p.w) - l),
      height: Math.max(0, Math.min(draw.h, p.y - draw.y + p.h, limitH ?? Number.POSITIVE_INFINITY) - t),
    },
    view: minimapView(cell, draw, leaf, iw, ih),
  }
}

const MINIMAP_ZOOM = 1.05
const MINIMAP_MIN_BOX = 260
/** The stage seat's clearance from the dock's top-left corner, in px. */
const STAGE_SEAT_GAP = 8
const STAGE_SEAT_INSET = 10

/** Whether a focused pane shows its minimap, given where the chip would sit. */
export function minimapVisible(o: { placement: 'pane' | 'stage', zoom: number, previewUrl?: string, boxWidth: number }): boolean {
  if (o.zoom <= MINIMAP_ZOOM || !o.previewUrl)
    return false
  return o.placement === 'stage' || o.boxWidth >= MINIMAP_MIN_BOX
}

/**
 * The stage-seated chip's box, relative to the stage root: its bottom edge 8px
 * above the tools dock's top, its left edge inset 10px from the dock's. Derived
 * from the dock rather than a stage constant, so the chip rides every display
 * the dock cycles through, and measured outside the canvas transform, so the
 * seat holds at every view zoom.
 */
export function stageMinimapSeat(dock: { left: number, top: number }, stage: { left: number, bottom: number }): { left: number, bottom: number } {
  return {
    left: dock.left - stage.left + STAGE_SEAT_INSET,
    bottom: stage.bottom - dock.top + STAGE_SEAT_GAP,
  }
}

/** The minimap window as CSS, so the render and a painted frame write the same values. */
export function minimapViewStyle(view: { x: number, y: number, w: number, h: number }) {
  return { left: `${view.x * 100}%`, top: `${view.y * 100}%`, width: `${view.w * 100}%`, height: `${view.h * 100}%` }
}

/**
 * Paint the chip's window after a pan or pinch. On compact widths the chip is
 * seated on the stage rather than inside the pane, so the pane painter cannot
 * find it; its box is fixed and only this window moves.
 */
export function paintMinimapView(
  el: HTMLElement | null | undefined,
  cell: Rect,
  draw: Rect,
  leaf: Leaf,
  iw: number,
  ih: number,
): void {
  if (!el || !iw || !ih)
    return
  assign(el, minimapViewStyle(minimapView(cell, draw, leaf, iw, ih)))
}

/** A divider's hit band. */
export function dividerBandStyle(d: Divider, gap: number, hitMin: number) {
  const hit = Math.max(gap, hitMin)
  const line = dividerLine(d, gap)
  return d.dir === 'row'
    ? { left: (line.x ?? 0) - hit / 2, top: d.area.y, width: hit, height: d.area.h }
    : { left: d.area.x, top: (line.y ?? 0) - hit / 2, width: d.area.w, height: hit }
}

/** A divider's grip: the line's midpoint (the pair of -50% classes centre it). */
export function dividerGripStyle(d: Divider, gap: number) {
  const line = dividerLine(d, gap)
  // `dividerLine` reports only the axis it owns; the 0 is unreachable, and it
  // keeps the style a plain record the DOM writer can assign.
  return d.dir === 'row'
    ? { left: line.x ?? 0, top: d.area.y + d.area.h / 2 }
    : { left: d.area.x + d.area.w / 2, top: line.y ?? 0 }
}

/** The pane elements a drag repaints, captured once when it starts. */
export interface PaintedBoard {
  panes: Map<string, HTMLElement>
  bands: Map<string, HTMLElement>
  grips: Map<string, HTMLElement>
}

/** Snapshot the elements a divider drag will move (they are stable for it). */
export function collectBoard(root: HTMLElement | null): PaintedBoard {
  const panes = new Map<string, HTMLElement>()
  const bands = new Map<string, HTMLElement>()
  const grips = new Map<string, HTMLElement>()
  if (!root)
    return { panes, bands, grips }
  for (const el of root.querySelectorAll<HTMLElement>('[data-pane-id]')) panes.set(el.dataset.paneId!, el)
  for (const el of root.querySelectorAll<HTMLElement>('[data-divider-band]')) bands.set(el.dataset.dividerBand!, el)
  for (const el of root.querySelectorAll<HTMLElement>('[data-divider-grip]')) grips.set(el.dataset.dividerGrip!, el)
  return { panes, bands, grips }
}

/**
 * Write a style object onto an element, the way React would: a bare number is
 * px (React appends the unit itself, and `style.left = 12` is simply discarded
 * by the CSSOM), a string is taken as written.
 */
function assign(el: HTMLElement, style: Record<string, string | number>) {
  for (const [prop, value] of Object.entries(style))
    el.style.setProperty(cssName(prop), typeof value === 'number' ? `${value}px` : value)
}

/** `borderRadius` → `border-radius`: `setProperty` speaks CSS, not the DOM API. */
function cssName(prop: string) {
  return prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
}

/**
 * The photo, the held Live Photo and the minimap of one pane, from a placement.
 * This is what a pan gesture paints every frame (`Pane` calls it directly), and
 * what a divider drag paints after moving the box.
 */
export function paintPanePhoto(el: HTMLElement | null | undefined, draw: PaneDraw, iw: number, ih: number) {
  if (!el || !iw || !ih)
    return
  const img = el.querySelector<HTMLImageElement>('[data-photo-img]')
  const transform = photoTransform(draw.rect, draw.draw, draw.leaf, iw, ih)
  if (img && transform)
    img.style.transform = transform
  const video = el.querySelector<HTMLVideoElement>('[data-live-video]')
  if (video)
    assign(video, photoBoxStyle(draw.rect, draw.draw, draw.leaf, iw, ih))
  const box = el.querySelector<HTMLElement>('[data-pane-minimap-box]')
  const view = el.querySelector<HTMLElement>('[data-pane-minimap-viewport]')
  if (box && view) {
    const m = minimapStyles(draw.rect, draw.draw, draw.leaf, iw, ih)
    assign(box, m.box)
    assign(view, minimapViewStyle(m.view))
  }
}

/** A pane's box, then everything inside it. */
function paintPane(el: HTMLElement | null | undefined, draw: PaneDraw) {
  if (!el)
    return
  assign(el, paneBoxStyle(draw.draw))
  // The preview's own size travels on the element (see `Pane`): the painter
  // cannot ask a hook for it, and reading it off the image races a decode.
  paintPanePhoto(el, draw, Number(el.dataset.photoW ?? 0), Number(el.dataset.photoH ?? 0))
}

/**
 * Paint a whole board: every pane box with the photo inside it, and the divider
 * chrome. Called on each move of a divider drag with the board as it would be
 * if the ratio were already committed.
 */
export function paintBoard(
  board: PaintedBoard,
  draws: PaneDraw[],
  dividers: Divider[],
  gap: number,
  hitMin: number,
): void {
  for (const draw of draws) paintPane(board.panes.get(draw.leaf.id), draw)
  for (const d of dividers) {
    const band = board.bands.get(d.id)
    if (band)
      assign(band, dividerBandStyle(d, gap, hitMin))
    const grip = board.grips.get(d.id)
    if (grip)
      assign(grip, dividerGripStyle(d, gap))
  }
}
