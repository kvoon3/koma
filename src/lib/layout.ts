/**
 * The pure layout math behind the stage: the canvas fit, the derived pane
 * rectangles / dividers the view draws from, and the lift that moves a legacy
 * pane's stickers and label onto the board. No store access: geometry is a
 * function of the tree alone, so it can be reasoned about (and measured)
 * without booting the store.
 */
import type { Workspace } from '../store'
import type { Photo } from './imageStore'
import type { Divider, Leaf, Node, PaneLabel, Rect, SeamSides, Sticker } from './panes'
import { layoutTree, leafList, placement, seamSides, stickerToBoard, uid, updateLeafIn } from './panes'

export interface Derived {
  W: number
  H: number
  leaves: { node: Leaf, rect: { x: number, y: number, w: number, h: number } }[]
  dividers: Divider[]
  gap: number
  radius: number
  fade: number
  unit: number
}

export function fitCanvas(
  canvasRatio: number | null,
  availW: number,
  availH: number,
): { W: number, H: number } {
  const ar = canvasRatio ?? 1.5
  let W = availW
  let H = W / ar
  if (H > availH) {
    H = availH
    W = H * ar
  }
  return { W, H }
}

export function computeLayout(
  root: Node,
  canvasRatio: number | null,
  canvasFill: number,
  availW: number,
  availH: number,
  gapValue: number,
  radiusValue: number,
  fadeValue: number,
): Derived {
  return withLiveLeaves(
    computeGeometry(root, { canvasRatio, canvasFill, availW, availH, gapValue, radiusValue, fadeValue }),
    root,
  )
}

/**
 * A board's geometry: the canvas box, every pane's rect by id, the dividers and
 * the unit. This is the half of `Derived` a pan, a turn or a filter cannot
 * change, because those move pixels inside a rect rather than the rect itself.
 * Keeping it identical is what lets the stage leave the rest of the board out
 * of the frame while one pane is being dragged (see `components/Stage`).
 */
export interface Geometry {
  W: number
  H: number
  rects: Map<string, Rect>
  dividers: Divider[]
  gap: number
  radius: number
  fade: number
  unit: number
}

/**
 * The tree's shape as a string: leaf ids, split directions and ratios, in tree
 * order. A board with the same shape lays out the same geometry whatever its
 * leaves hold, so this string is a sound memo key for `cachedGeometry`. One
 * pass over the tree, no per-node allocation beyond the key's own pieces.
 * Ratios keep 6 decimals: below a millionth of a cell two ratios are the same
 * line on screen.
 */
export function paneShape(root: Node): string {
  const walk = (n: Node): string =>
    n.type === 'leaf'
      ? `l${n.id}`
      : `s${n.dir === 'row' ? 'r' : 'c'}${n.ratio.toFixed(6)}(${walk(n.a)},${walk(n.b)})`
  return walk(root)
}

/** Everything geometry depends on besides the tree: the canvas box and the dials. */
interface GeometryBox {
  canvasRatio: number | null
  canvasFill: number
  availW: number
  availH: number
  gapValue: number
  radiusValue: number
  fadeValue: number
}

function boxKey(shape: string, b: GeometryBox): string {
  return `${shape}|${b.canvasRatio ?? 'x'}|${b.canvasFill}|${b.availW}|${b.availH}|${b.gapValue}|${b.radiusValue}|${b.fadeValue}`
}

/** Geometry for a tree: the canvas fit, then the layout, rects keyed by pane id. */
export function computeGeometry(root: Node, b: GeometryBox): Geometry {
  const fit = fitCanvas(b.canvasRatio, b.availW, b.availH)
  const W = Math.max(80, Math.round(fit.W * b.canvasFill))
  const H = Math.max(80, Math.round(fit.H * b.canvasFill))
  const u = Math.min(W, H) / 1000
  const gap = b.gapValue * u
  const l = layoutTree(root, W, H, gap)
  const rects = new Map<string, Rect>()
  for (const { node, rect } of l.leaves)
    rects.set(node.id, rect)
  return { W, H, rects, dividers: l.dividers, gap, radius: b.radiusValue * u, fade: b.fadeValue * u, unit: u }
}

/**
 * A one-slot memo across renders, for callers that compute the board's
 * geometry during render. `Stage` is the only one: it re-renders on every
 * pointermove of a drag, and without this cache the layout (and so every
 * pane's rect object) would be rebuilt per frame.
 */
export interface GeometryCache {
  key: string | null
  geo: Geometry | null
}

export function emptyGeometryCache(): GeometryCache {
  return { key: null, geo: null }
}

/** `computeGeometry`, kept across calls while the tree's shape and box hold still. */
export function cachedGeometry(cache: GeometryCache, root: Node, b: GeometryBox): Geometry {
  const shape = paneShape(root)
  const key = boxKey(shape, b)
  if (cache.geo && cache.key === key)
    return cache.geo
  const geo = computeGeometry(root, b)
  cache.key = key
  cache.geo = geo
  return geo
}

/** A one-slot memo for `seamSides`, the same trick as `GeometryCache`. */
export interface SeamsCache {
  geo: Geometry | null
  photoKey: string
  seams: Map<string, SeamSides>
}

export function emptySeamsCache(): SeamsCache {
  return { geo: null, photoKey: '', seams: new Map() }
}

/**
 * Which pane edges are seams, kept across calls while the geometry holds and
 * no pane gains or loses its photo. Those are the only inputs `seamSides`
 * reads, so a drag inside a pane reuses the map, and with it every pane's
 * `seam` prop.
 */
export function cachedSeams(cache: SeamsCache, root: Node, geo: Geometry): Map<string, SeamSides> {
  const leaves = leafList(root)
  const photoKey = leaves.map(l => l.photoId ?? '').join(',')
  if (cache.geo === geo && cache.photoKey === photoKey)
    return cache.seams
  const seams = seamSides(withLiveLeaves(geo, root).leaves, geo.gap)
  cache.geo = geo
  cache.photoKey = photoKey
  cache.seams = seams
  return seams
}

/**
 * Pair cached geometry with the leaves of the tree as it stands now: the
 * `Derived` the stage draws. The rects are handed through by reference, so a
 * pane whose cell did not move keeps the same rect object and memoizes away.
 * A leaf the geometry does not know (a pane added since the geometry was
 * cached) falls back to the whole canvas rather than vanishing.
 */
export function withLiveLeaves(geo: Geometry, root: Node): Derived {
  const whole: Rect = { x: 0, y: 0, w: geo.W, h: geo.H }
  const leaves = leafList(root).map(node => ({ node, rect: geo.rects.get(node.id) ?? whole }))
  return { W: geo.W, H: geo.H, leaves, dividers: geo.dividers, gap: geo.gap, radius: geo.radius, fade: geo.fade, unit: geo.unit }
}

function liftLeafStickers(
  node: Leaf,
  rect: { x: number, y: number, w: number, h: number },
  board: { w: number, h: number },
  photoById: Map<string, Photo>,
): Sticker[] {
  const photo = node.photoId ? photoById.get(node.photoId) : undefined
  const place = photo?.trueW && photo.trueH
    ? placement(rect, node, photo.trueW, photo.trueH)
    : { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  return node.stickers.map((st) => {
    const sp = photoById.get(st.photoId)
    if (sp?.trueW && sp.trueH)
      return stickerToBoard(st, place, board, sp.trueW, sp.trueH)
    return {
      ...st,
      x: (rect.x + rect.w / 2) / board.w,
      y: (rect.y + rect.h / 2) / board.h,
      s: 0.2,
    }
  })
}

/** A legacy pane-normalized label re-expressed in board coords (size is already board-unit). */
function liftLeafLabel(
  lab: PaneLabel,
  rect: { x: number, y: number, w: number, h: number },
  board: { w: number, h: number },
): PaneLabel {
  return {
    ...lab,
    id: lab.id ?? uid('l'),
    x: (rect.x + lab.x * rect.w) / board.w,
    y: (rect.y + lab.y * rect.h) / board.h,
  }
}

/** Lift legacy per-leaf stickers and labels onto the workspace board and clear the leaves. */
export function migrateWorkspaceInserts(
  ws: Workspace,
  photos: Photo[],
  availW = 1000,
  availH = 1000,
): Workspace {
  const stickers = ws.stickers ?? []
  const labels = ws.labels ?? []
  if (!leafList(ws.root).some(l => l.stickers.length > 0 || l.label))
    return stickers === ws.stickers && labels === ws.labels ? ws : { ...ws, stickers, labels }
  const photoById = new Map(photos.map(p => [p.id, p]))
  const derived = computeLayout(ws.root, ws.canvasRatio, ws.canvasFill, availW, availH, 0, 0, 0)
  const board = { w: derived.W, h: derived.H }
  const lifted: Sticker[] = [...stickers]
  const liftedLabels: PaneLabel[] = [...labels]
  let root = ws.root
  for (const { node, rect } of derived.leaves) {
    if (!node.stickers.length && !node.label)
      continue
    lifted.push(...liftLeafStickers(node, rect, board, photoById))
    if (node.label)
      liftedLabels.push(liftLeafLabel(node.label, rect, board))
    root = updateLeafIn(root, node.id, { stickers: [], label: null })
  }
  return { ...ws, root, stickers: lifted, labels: liftedLabels }
}
