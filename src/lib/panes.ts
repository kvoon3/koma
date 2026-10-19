import type { CSSProperties } from 'react'
import type { FilterValue } from './filters'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Sticker {
  id: string
  photoId: string
  /** Board-normalized center x in [0, 1] of the canvas width. */
  x: number
  /** Board-normalized center y in [0, 1] of the canvas height. */
  y: number
  /** Sticker width as a fraction of min(canvas W, H). */
  s: number
  /** Rotation in radians; absent means unrotated (see `rotationOf`). */
  rot?: number
}

/**
 * Label box themes. `dark` and `light` are opaque black/white pairs so the
 * text stays readable over any photo; `glow` drops the box entirely and paints
 * pure white text inside a soft white/blue halo (neon on a lightbox), so it
 * reads over a photo without a plate hiding it. All three draw identically in
 * the preview (CSS) and the exporter (canvas).
 */
export const LABEL_THEMES = {
  dark: { bg: '#000000', fg: '#ffffff' },
  light: { bg: '#ffffff', fg: '#000000' },
  glow: { bg: 'transparent', fg: '#ffffff', glow: true },
} as const

export type LabelTheme = keyof typeof LABEL_THEMES

/** One theme's pair, plus the glow marker only the box-less theme carries. */
export type LabelThemeSpec = (typeof LABEL_THEMES)[LabelTheme]

export const DEFAULT_LABEL_THEME: LabelTheme = 'dark'

/** Picker order: the two box themes, then the box-less glow. */
export const LABEL_THEME_IDS = ['dark', 'light', 'glow'] as const satisfies readonly LabelTheme[]

export const nextLabelTheme = (theme: LabelTheme): LabelTheme => (theme === 'dark' ? 'light' : 'dark')

/** Tolerates a missing/unknown theme (e.g. a hand-built export option). */
export function labelColors(theme?: LabelTheme) {
  return LABEL_THEMES[theme && theme in LABEL_THEMES ? theme : DEFAULT_LABEL_THEME]
}

/**
 * One halo layer under the glow theme's text. The blur is in em of the label's
 * font size, so the preview (CSS `em`) and the exporter (`blur × font px`)
 * share one scale and the halo grows with the text instead of staying a fixed
 * px halo on a giant label.
 */
export interface LabelGlowLayer {
  /** Gaussian blur radius, as a fraction of the font size. */
  blur: number
  /** Halo color, `rgba()` so layering adds up the same way in CSS and canvas. */
  color: string
}

/**
 * The glow stack, tightest first: CSS paints text shadows back to front, so the
 * tight blue rim listed first sits on top of the wide cool halo. The white
 * layer carries the light on a dark photo; the blue rim and outer halo give the
 * white glyph an edge on a light one, where white alone would wash out.
 *
 * The last, widest layer is a dark navy rim behind the whole glow. It is the
 * same trick the box themes use (a dark plate behind white text): on a light
 * photo it takes the paper-white background under the halo down a few levels,
 * which is what separates the white core from a white surface. On a dark photo
 * it never darkens the background (measured: no pixel outside the glow falls
 * below the photo's own luminance), it only trims the faint outer halo, so the
 * neon look there is unchanged. Alpha 0.6 was the knee: 0.75 bought ~1 more
 * grey level on light and nothing on dark (see the lane's measurements).
 */
export const LABEL_GLOW_LAYERS: readonly LabelGlowLayer[] = [
  { blur: 0.05, color: 'rgba(40, 120, 255, 1)' },
  { blur: 0.1, color: 'rgba(255, 255, 255, 0.95)' },
  { blur: 0.22, color: 'rgba(190, 222, 255, 0.9)' },
  { blur: 0.5, color: 'rgba(70, 140, 255, 0.85)' },
  { blur: 0.55, color: 'rgba(18, 28, 58, 0.6)' },
]

/**
 * How the exporter maps a layer's em blur onto `ctx.shadowBlur`. Measured at
 * 1:1 against a DOM screenshot of the same CSS stack (see the lane's halo
 * check: decay radii within 2 px at a 128 px font), so the CSS stack stays the
 * single source; the knob exists because the two blur models are only
 * empirically equal and a Chrome change may need re-measuring.
 */
export const LABEL_GLOW_CANVAS_SCALE = 1

/** The halo layers of a theme; undefined for the two plain box themes. */
export function labelGlowLayers(theme?: LabelTheme): readonly LabelGlowLayer[] | undefined {
  const spec: LabelThemeSpec = labelColors(theme)
  return 'glow' in spec && spec.glow ? LABEL_GLOW_LAYERS : undefined
}

/** The preview's CSS `text-shadow` for a theme, or undefined when it has no glow. */
export function labelTextShadow(theme?: LabelTheme): string | undefined {
  return labelGlowLayers(theme)?.map(layer => `0 0 ${layer.blur}em ${layer.color}`).join(', ')
}

/** A label's effective colors: custom fg / bg win over its theme pair. */
export function labelPaint(lab: { theme?: LabelTheme, fg?: string, bg?: string, bgAlpha?: number }) {
  const base = labelColors(lab.theme)
  const bg = lab.bg ?? base.bg
  return { fg: lab.fg ?? base.fg, bg, fill: withAlpha(bg, labelBgAlpha(lab)) }
}

/** Box opacity in [0, 1]; absent means fully opaque. */
export function labelBgAlpha(lab: { bgAlpha?: number }) {
  const a = lab.bgAlpha
  return typeof a === 'number' && Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1
}

function withAlpha(hex: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (a >= 1 || !m)
    return hex
  const n = Number.parseInt(m[1], 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** Horizontal alignment of a label's lines inside its box. */
export type LabelAlign = 'left' | 'center' | 'right'

/**
 * A label's alignment. Absent means center, which is exactly how every label
 * laid out before alignment existed (single line = a shrink-wrapped box), so
 * old sessions hydrate unchanged.
 */
export const labelAlign = (lab: { align?: LabelAlign }): LabelAlign => lab.align ?? 'center'

/**
 * Lines render at explicit `\n` only. Labels are placed freely on the board
 * (a label is not a text box with an authored width), so auto-wrap would make
 * a line's break depend on the current font size and the board's pixel size,
 * and preview and export would disagree at different scales. One newline =
 * one line, always.
 */
export const labelTextLines = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n')

/**
 * What the editor commits: CRLF normalized, each line trimmed, blank lines at
 * either end dropped, blank lines inside kept (a deliberate gap between
 * paragraphs). Interior blank lines survive a close/reopen, and the text never
 * carries layout-significant trailing whitespace into the measured box.
 */
export function normalizeLabelText(raw: string): string {
  const lines = labelTextLines(raw).map(line => line.trim())
  while (lines.length && !lines[0])
    lines.shift()
  while (lines.length && !lines[lines.length - 1])
    lines.pop()
  return lines.join('\n')
}

/**
 * A line's x offset inside the text block (the widest line defines the block),
 * shared by the DOM preview (as CSS `text-align`) and the exporter's canvas
 * `fillText`, so the two cannot pick different origins for one alignment.
 */
export function labelAlignOffset(align: LabelAlign, maxW: number, lineW: number): number {
  if (align === 'left')
    return 0
  const gap = maxW - lineW
  return align === 'right' ? gap : gap / 2
}

export interface PaneLabel {
  /** Stable id: labels are a board-level list, many per workspace. */
  id: string
  text: string
  font: string
  theme: LabelTheme
  /** Custom text color; absent falls back to the theme's. */
  fg?: string
  /** Custom box color; absent falls back to the theme's. */
  bg?: string
  /** Box opacity in [0, 1]; absent means opaque. */
  bgAlpha?: number
  /** Leading icon id from `LABEL_ICONS`; absent means text only. */
  icon?: string
  /** Board-normalized center in [0, 1] of the canvas (legacy Leaf.label: pane-normalized). */
  x: number
  y: number
  size: number
  /** Rotation in radians; absent means unrotated (see `rotationOf`). */
  rot?: number
  /** Line alignment; absent means center (see `labelAlign`). */
  align?: LabelAlign
}

export interface Leaf {
  type: 'leaf'
  id: string
  photoId: string | null
  zoom: number
  cx: number
  cy: number
  /**
   * Pane photo rotation in radians, wrapped to (-π, π]; absent means upright
   * (see `rotationOf`). The dial in the tools drawer sets it; preview and
   * export both draw it through `paneTransform`.
   */
  rot?: number
  /** Mirror the pane's photo left/right; absent means not flipped. */
  flipX?: boolean
  /** Mirror the pane's photo top/bottom; absent means not flipped. */
  flipY?: boolean
  /**
   * Tactile texture filter over the photo (see `lib/filters`); absent means
   * none. It travels with the photo like `rot` and the mirrors: it resets when
   * a photo arrives, and copies with duplicate / copy+paste / swap. Preview and
   * export both run the filter on the photo's pixels before placement and the
   * turn, so the texture is baked into the photo rather than laid over the pane.
   *
   * A *value*, not just an id: the pixel family carries its dialled knobs
   * (`{ id: 'mosaic', block: 24, levels: 6 }`, see `FilterSpec`), and a bare id
   * from a build before knobs hydrates as that filter's defaults. Undo, copy and
   * paste treat the whole value atomically.
   */
  filter?: FilterValue
  /**
   * Legacy per-pane stickers. New inserts live on `Workspace.stickers` (board
   * space). Kept so session / `.koma.json` files migrate without data loss.
   */
  stickers: Sticker[]
  /** Legacy per-pane label; new labels live on `Workspace.labels`. */
  label: PaneLabel | null
}

export interface Split {
  type: 'split'
  id: string
  dir: 'row' | 'column'
  ratio: number
  a: Node
  b: Node
}

export type Node = Leaf | Split

let seq = 0
/**
 * Ids outlive the page: a restored session holds the ids the last page load
 * generated, while `seq` restarts from zero on every load, so a bare counter
 * re-issues them on the first new pane after a refresh (two leaves sharing an
 * id breaks every `findLeaf` and every React key). The per-load seed keeps new
 * ids apart from anything a previous load handed out. It is a uniqueness tag,
 * not a secret: nothing is derived from it and nothing compares against it.
 */
const loadSeed = Math.random().toString(36).slice(2, 6)
export const uid = (p: string) => `${p}${(++seq).toString(36)}${loadSeed}`

export function newLeaf(): Leaf {
  return {
    type: 'leaf',
    id: uid('p'),
    photoId: null,
    zoom: 1,
    cx: 0.5,
    cy: 0.5,
    stickers: [],
    label: null,
  }
}

/**
 * A deep copy of a pane tree with a fresh id on every node, sticker and
 * label: photos are library-wide (`photoId` copies as-is), everything the
 * store addresses by id must not collide with the original. Used when a new
 * grid group copies the open board (store.addGrid).
 */
export function cloneNode(node: Node): Node {
  if (node.type === 'leaf') {
    return {
      ...node,
      id: uid('p'),
      stickers: node.stickers.map(st => ({ ...st, id: uid('s') })),
      label: node.label ? { ...node.label, id: uid('l') } : null,
    }
  }
  return { ...node, id: uid('s'), a: cloneNode(node.a), b: cloneNode(node.b) }
}

export const DEFAULT_LABEL_SIZE = 42

export function newLabel(x = 0.5, y = 0.5): PaneLabel {
  return { id: uid('l'), text: 'Label', font: '', theme: DEFAULT_LABEL_THEME, x, y, size: DEFAULT_LABEL_SIZE, rot: 0 }
}

/**
 * Rotation in radians, 0 when absent: `.koma.json` files and session snapshots
 *  saved before rotation existed simply have no field, the same tolerance
 *  `labelColors()` shows for an unknown theme.
 */
export const rotationOf = (box: { rot?: number }) => box.rot ?? 0

/** The CSS `rotate()` a sticker/label box draws with. */
export const rotationCss = (box: { rot?: number }) => `rotate(${rotationOf(box)}rad)`

const TAU = Math.PI * 2

/** Fold an angle into (-π, π], so a saved rotation stays readable. */
export function wrapAngle(a: number): number {
  const t = a % TAU
  if (t > Math.PI)
    return t - TAU
  if (t <= -Math.PI)
    return t + TAU
  return t
}

/** 15°: the step a held Shift snaps a rotation drag to. */
export const ROTATION_SNAP = Math.PI / 12

export function snapRotation(rot: number, snap: boolean): number {
  return wrapAngle(snap ? Math.round(rot / ROTATION_SNAP) * ROTATION_SNAP : rot)
}

/** Rotate a local (x, y) offset around a box center by `a` radians. */
export function rotateOffset(x: number, y: number, a: number): { x: number, y: number } {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: x * c - y * s, y: x * s + y * c }
}

/**
 * Shared by preview and export: rect for a label's always-opaque box,
 *  centered on (lab.x, lab.y), padded proportionally to the font size.
 */
export function labelRect(
  cell: Rect,
  lab: PaneLabel,
  textW: number,
  textH: number,
  fontPx: number,
): Rect {
  const padX = fontPx * 0.38
  const padY = fontPx * 0.22
  const w = textW + padX * 2
  const h = textH + padY * 2
  return {
    x: cell.x + lab.x * cell.w - w / 2,
    y: cell.y + lab.y * cell.h - h / 2,
    w,
    h,
  }
}

export function findLeaf(root: Node, id: string): Leaf | null {
  if (root.type === 'leaf')
    return root.id === id ? root : null
  return findLeaf(root.a, id) ?? findLeaf(root.b, id)
}

export type FocusDir = 'left' | 'right' | 'up' | 'down'

/**
 * Gaps from `from` toward `r`: signed gap along `dir`'s axis (`main`) and
 *  the non-negative gap across it (`cross`); null when `r` lies behind.
 */
function gapMetrics(
  dir: FocusDir,
  from: Rect,
  r: Rect,
): { main: number, cross: number } | null {
  const horizontal = dir === 'right' || dir === 'left'
  const main = horizontal
    ? (dir === 'right' ? r.x - (from.x + from.w) : from.x - (r.x + r.w))
    : (dir === 'down' ? r.y - (from.y + from.h) : from.y - (r.y + r.h))
  if (main < -1)
    return null
  const cross = horizontal
    ? Math.max(0, Math.max(from.y, r.y) - Math.min(from.y + from.h, r.y + r.h))
    : Math.max(0, Math.max(from.x, r.x) - Math.min(from.x + from.w, r.x + r.w))
  return { main, cross }
}

export function neighborLeaf(
  leaves: { node: Leaf, rect: Rect }[],
  from: Rect,
  dir: FocusDir,
): Leaf | null {
  let best: { node: Leaf, rect: Rect } | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const l of leaves) {
    const m = gapMetrics(dir, from, l.rect)
    if (!m)
      continue
    const score = Math.max(0, m.main) + m.cross * 4
    if (score < bestScore) {
      bestScore = score
      best = l
    }
  }
  return best ? best.node : null
}

export function leafList(root: Node): Leaf[] {
  if (root.type === 'leaf')
    return [root]
  return [...leafList(root.a), ...leafList(root.b)]
}

export function leafCount(root: Node): number {
  return root.type === 'leaf' ? 1 : leafCount(root.a) + leafCount(root.b)
}

function mapNode(node: Node, id: string, fn: (n: Node) => Node): Node {
  if (node.id === id)
    return fn(node)
  if (node.type === 'leaf')
    return node
  const a = mapNode(node.a, id, fn)
  const b = mapNode(node.b, id, fn)
  if (a === node.a && b === node.b)
    return node
  return { ...node, a, b }
}

export function splitLeaf(root: Node, paneId: string, dir: 'row' | 'column'): Node {
  return mapNode(root, paneId, (n) => {
    if (n.type !== 'leaf')
      return n
    return {
      type: 'split',
      id: uid('s'),
      dir,
      ratio: 0.5,
      a: n,
      b: newLeaf(),
    }
  })
}

export function removeLeaf(root: Node, paneId: string): Node | null {
  if (root.type === 'leaf')
    return root.id === paneId ? null : root
  const a = removeLeaf(root.a, paneId)
  const b = removeLeaf(root.b, paneId)
  if (!a)
    return b
  if (!b)
    return a
  if (a === root.a && b === root.b)
    return root
  return { ...root, a, b }
}

/**
 * Drag-to-delete on the stage: drop the pane from the split tree so its
 * sibling takes over the freed space (same collapse as closing a pane). The
 * last remaining pane can't collapse into nothing, so it is cleared in place
 * instead: same id (focus stays valid), no photo, stickers or label. An
 * unknown id returns the root untouched.
 */
export function deletePane(root: Node, paneId: string): Node {
  if (!findLeaf(root, paneId))
    return root
  const next = removeLeaf(root, paneId)
  return next ?? { ...newLeaf(), id: paneId }
}

/**
 * A pane carry dropped on another pane swaps what the two hold: photo and its
 * placement (pan, zoom, turn and mirrors); per-pane stickers and labels are
 * cleared on both (as before).
 * Either side may be empty, so an empty pane dropped on a photo pane pulls
 * the photo over and leaves the target empty. Two empty panes, the same pane
 * or an unknown id leave the root untouched.
 */
export function swapLeafContents(root: Node, a: string, b: string): Node {
  const la = findLeaf(root, a)
  const lb = findLeaf(root, b)
  if (!la || !lb || a === b || (!la.photoId && !lb.photoId))
    return root
  const take = (l: Leaf): Partial<Leaf> => ({
    photoId: l.photoId,
    zoom: l.zoom,
    cx: l.cx,
    cy: l.cy,
    rot: l.rot,
    flipX: l.flipX,
    flipY: l.flipY,
    filter: l.filter,
    stickers: [],
    label: null,
  })
  return updateLeafIn(updateLeafIn(root, a, take(lb)), b, take(la))
}

/**
 * What a primary press on a pane sets up. Every pane can be carried (touch
 * long-press arms it; the menu's Move covers the mouse), photo or not; only a
 * photo pane pans/pinches, and only that needs the pointer captured. An empty
 * pane keeps its press uncaptured so the tap still reaches its picker button.
 */
export function pressPlan(hasPhoto: boolean, pointerType: string): { capture: boolean, pan: boolean, armHold: boolean } {
  return { capture: hasPhoto, pan: hasPhoto, armHold: pointerType !== 'mouse' }
}

export function updateLeafIn(root: Node, paneId: string, patch: Partial<Leaf>): Node {
  return mapNode(root, paneId, n => (n.type === 'leaf' ? { ...n, ...patch } : n))
}

export function setSplitRatioIn(root: Node, splitId: string, ratio: number): Node {
  return mapNode(root, splitId, n =>
    n.type === 'split' ? { ...n, ratio: Math.min(0.95, Math.max(0.05, ratio)) } : n)
}

export interface Divider {
  id: string
  dir: 'row' | 'column'
  area: Rect
  ratio: number
}

export interface TreeLayout {
  leaves: { node: Leaf, rect: Rect }[]
  dividers: Divider[]
}

/**
 * Split `avail` into an integer-friendly first-pane size. Remainder goes to
 * the second pane so `a + b === avail` exactly. Rounding kills the .5 /
 * repeating-fraction seams that show board BG (#000) as a hairline on iOS
 * when gap is 0 (Stage overflow+transform and canvas clip AA both leak it).
 * Local 1px floor only; avoids importing MIN_PANE_PX from the store.
 */
function snappedSplit(avail: number, ratio: number): number {
  if (avail <= 0)
    return 0
  let a = Math.round(avail * ratio)
  if (avail >= 2)
    a = Math.min(avail - 1, Math.max(1, a))
  else
    a = Math.min(avail, Math.max(0, a))
  return a
}

function walk(node: Node, rect: Rect, gap: number, out: TreeLayout) {
  if (node.type === 'leaf') {
    out.leaves.push({ node, rect })
    return
  }
  out.dividers.push({ id: node.id, dir: node.dir, area: rect, ratio: node.ratio })

  if (node.dir === 'row') {
    const avail = Math.max(0, rect.w - gap)
    const aw = snappedSplit(avail, node.ratio)
    walk(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }, gap, out)
    walk(node.b, { x: rect.x + aw + gap, y: rect.y, w: avail - aw, h: rect.h }, gap, out)
  }
  else {
    const avail = Math.max(0, rect.h - gap)
    const ah = snappedSplit(avail, node.ratio)
    walk(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah }, gap, out)
    walk(node.b, { x: rect.x, y: rect.y + ah + gap, w: rect.w, h: avail - ah }, gap, out)
  }
}

export function layoutTree(root: Node, W: number, H: number, gap: number): TreeLayout {
  const out: TreeLayout = { leaves: [], dividers: [] }
  walk(root, { x: gap, y: gap, w: Math.max(0, W - gap * 2), h: Math.max(0, H - gap * 2) }, gap, out)
  return out
}

export function dividerLine(d: Divider, gap: number): { x?: number, y?: number } {
  if (d.dir === 'row') {
    return { x: d.area.x + (d.area.w - gap) * d.ratio + gap / 2 }
  }
  return { y: d.area.y + (d.area.h - gap) * d.ratio + gap / 2 }
}

/** Which edges of a pane face another photo-bearing pane across the gap. */
export interface SeamSides {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

/** Mark which edges of `ra` face `rb` across the gap. */
function markSides(sides: SeamSides, ra: Rect, rb: Rect, tol: number) {
  const overlapY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y)
  const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x)
  if (overlapY > 0.5) {
    if (Math.abs(rb.x - (ra.x + ra.w)) <= tol)
      sides.right = true
    if (Math.abs(ra.x - (rb.x + rb.w)) <= tol)
      sides.left = true
  }
  if (overlapX > 0.5) {
    if (Math.abs(rb.y - (ra.y + ra.h)) <= tol)
      sides.bottom = true
    if (Math.abs(ra.y - (rb.y + rb.h)) <= tol)
      sides.top = true
  }
}

/**
 * Seam edges per leaf: an edge counts when another leaf WITH a photo sits
 *  beside it across the gap (flush at gap=0). Feathers only run between
 *  photos, never against empty panes or the canvas border.
 */
export function seamSides(
  leaves: { node: Leaf, rect: Rect }[],
  gap: number,
): Map<string, SeamSides> {
  const out = new Map<string, SeamSides>()
  for (const { node } of leaves)
    out.set(node.id, { left: false, right: false, top: false, bottom: false })
  const tol = gap + 0.5
  for (const { node: a, rect: ra } of leaves) {
    for (const { node: b, rect: rb } of leaves) {
      if (a.id === b.id || !b.photoId)
        continue
      markSides(out.get(a.id)!, ra, rb, tol)
    }
  }
  return out
}

/** Feather width for a pane, clamped so opposed fades never eat the whole cell. */
export function seamFadeWidth(fade: number, rect: Rect) {
  return Math.max(0, Math.min(fade, rect.w / 2, rect.h / 2))
}

/**
 * Fade px used for crossfade overlap. Strength scales intensity; gap>0
 * disables overlap so intentional gutters keep solid gap fill.
 */
export function blendFadePx(fade: number, strength: number, gap: number) {
  if (gap > 0 || fade <= 0 || strength <= 0)
    return 0
  return fade * Math.min(1, Math.max(0, strength / 100))
}

/**
 * Grow a layout rect into each photo-photo seam by half the fade so neighbors
 * overlap; opposing masks then crossfade sharp photos in that band.
 */
export function expandRectForBlend(rect: Rect, seam: SeamSides | undefined, fadePx: number): Rect {
  if (!seam || fadePx <= 0)
    return rect
  const g = seamFadeWidth(fadePx, rect) / 2
  let { x, y, w, h } = rect
  if (seam.left) {
    x -= g
    w += g
  }
  if (seam.right)
    w += g
  if (seam.top) {
    y -= g
    h += g
  }
  if (seam.bottom)
    h += g
  return { x, y, w, h }
}

/** Per-corner radii in CSS / canvas order: top-left, top-right, bottom-right, bottom-left. */
export type CornerRadii = [number, number, number, number]

/**
 * When gap is 0, square the corners that sit on a photo-photo seam so adjacent
 * leaves meet flush. Outer corners keep `radius`. With gap > 0 the full radius
 * stays so intentional gutters keep their rounded look.
 */
export function leafCornerRadii(
  radius: number,
  seam: SeamSides | undefined,
  gap: number,
): CornerRadii {
  const r = Math.max(0, radius)
  if (gap > 0 || r === 0 || !seam)
    return [r, r, r, r]
  return [
    seam.left || seam.top ? 0 : r,
    seam.right || seam.top ? 0 : r,
    seam.right || seam.bottom ? 0 : r,
    seam.left || seam.bottom ? 0 : r,
  ]
}

export function cornerRadiiCss(radii: CornerRadii): string {
  return `${radii[0]}px ${radii[1]}px ${radii[2]}px ${radii[3]}px`
}

/** CSS mask feathering a pane's seam edges; undefined when nothing fades. */
export function seamMaskStyle(seam: SeamSides | undefined, w: number): CSSProperties | undefined {
  if (!seam || w <= 0)
    return undefined
  const solid = '#000'
  const parts: string[] = []
  if (seam.left)
    parts.push(`linear-gradient(to right, transparent, ${solid} ${w}px)`)
  if (seam.right)
    parts.push(`linear-gradient(to left, transparent, ${solid} ${w}px)`)
  if (seam.top)
    parts.push(`linear-gradient(to bottom, transparent, ${solid} ${w}px)`)
  if (seam.bottom)
    parts.push(`linear-gradient(to top, transparent, ${solid} ${w}px)`)
  if (!parts.length)
    return undefined
  const image = parts.join(', ')
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  }
}

export function ratioFromPointer(
  d: Divider,
  px: number,
  py: number,
  gap: number,
  minPx: number,
): number {
  if (d.dir === 'row') {
    const avail = Math.max(1, d.area.w - gap)
    const local = px - d.area.x - gap / 2
    const lo = Math.min(0.45, minPx / avail)
    return Math.min(1 - lo, Math.max(lo, local / avail))
  }
  const avail = Math.max(1, d.area.h - gap)
  const local = py - d.area.y - gap / 2
  const lo = Math.min(0.45, minPx / avail)
  return Math.min(1 - lo, Math.max(lo, local / avail))
}

export function placement(cell: Rect, leaf: Leaf, iw: number, ih: number) {
  const scale = Math.max(cell.w / iw, cell.h / ih) * leaf.zoom
  const w = iw * scale
  const h = ih * scale
  return {
    x: cell.x + cell.w / 2 - leaf.cx * w,
    y: cell.y + cell.h / 2 - leaf.cy * h,
    w,
    h,
    scale,
  }
}

export function clampLeaf(leaf: Leaf, cell: Rect, iw: number, ih: number): Leaf {
  const scale = Math.max(cell.w / iw, cell.h / ih) * leaf.zoom
  const w = iw * scale
  const h = ih * scale
  const hx = Math.min(0.5, cell.w / 2 / w)
  const hy = Math.min(0.5, cell.h / 2 / h)
  return {
    ...leaf,
    cx: Math.min(1 - hx, Math.max(hx, leaf.cx)),
    cy: Math.min(1 - hy, Math.max(hy, leaf.cy)),
  }
}

/** Which way a pane's photo is mirrored (absent means neither). */
export const paneFlipped = (leaf: { flipX?: boolean, flipY?: boolean }) => ({ x: !!leaf.flipX, y: !!leaf.flipY })

/** The pane-photo transform preview and export share: flip, cover-scale, then turn. */
export interface PaneTransform {
  /** Rotation in radians, wrapped to (-π, π]. */
  rot: number
  /** Extra zoom that keeps a rotated photo covering its cell (≥ 1). */
  cover: number
  /** Multipliers on the placed photo, the flip signs included. */
  scaleX: number
  scaleY: number
}

/**
 * How much the placed photo must grow so a turn leaves no empty corners: under
 * the rotation the cell's pre-image is a diamond whose bounding box is
 * (w·|cos| + h·|sin|) × (w·|sin| + h·|cos|), and the photo already covers the
 * cell, so it has to cover that box too. 45° on a square gives √2, the tight
 * answer for that case.
 */
export function rotationCoverScale(rot: number, w: number, h: number): number {
  if (w <= 0 || h <= 0)
    return 1
  const c = Math.abs(Math.cos(rot))
  const s = Math.abs(Math.sin(rot))
  return Math.max(1, c + (h * s) / w, c + (w * s) / h)
}

/**
 * The transform a pane's photo is drawn with, about the center of `cell` (the
 * box the photo is clipped into, i.e. the pane): flip and cover-scale first,
 * then the turn. The preview spells it as CSS (`paneTransformCss`), the exporter
 * as canvas calls, both from this one result, so the two cannot drift.
 */
export function paneTransform(
  cell: { w: number, h: number },
  leaf: { rot?: number, flipX?: boolean, flipY?: boolean },
): PaneTransform {
  const rot = wrapAngle(rotationOf(leaf))
  const cover = rotationCoverScale(rot, cell.w, cell.h)
  const flip = paneFlipped(leaf)
  return { rot, cover, scaleX: (flip.x ? -1 : 1) * cover, scaleY: (flip.y ? -1 : 1) * cover }
}

/** Does this transform do anything? An upright, unflipped pane skips the layer. */
export const isPaneTransformed = (t: PaneTransform) => t.rot !== 0 || t.scaleX !== 1 || t.scaleY !== 1

/**
 * `paneTransform` as the CSS a layer covering the pane box draws with. The
 * layer's origin is its center (the pane's center), so the turn is about the
 * middle of the pane just as `ctx.rotate` is in the exporter.
 */
export function paneTransformCss(t: PaneTransform): string {
  return `rotate(${t.rot}rad) scale(${t.scaleX}, ${t.scaleY})`
}

/**
 * Legacy photo-local sticker rect (pre board-layer). Used only when migrating
 * old `Leaf.stickers` into board space.
 */
export function stickerRect(
  place: { x: number, y: number, w: number, h: number },
  st: Sticker,
  trueW: number,
  trueH: number,
  aspect: number,
): Rect {
  const unit = Math.min(trueW, trueH)
  const w = ((st.s * unit) / trueW) * place.w
  const h = w / aspect
  return {
    x: place.x + st.x * place.w - w / 2,
    y: place.y + st.y * place.h - h / 2,
    w,
    h,
  }
}

/** Board-space sticker rect: `st.x/y` are canvas-normalized, `st.s` is min-side fraction. */
export function boardStickerRect(
  board: { w: number, h: number },
  st: Sticker,
  aspect: number,
): Rect {
  const unit = Math.min(board.w, board.h)
  const w = Math.max(4, st.s * unit)
  const h = w / aspect
  return {
    x: st.x * board.w - w / 2,
    y: st.y * board.h - h / 2,
    w,
    h,
  }
}

/** Convert a legacy photo-local sticker into board-normalized form. */
export function stickerToBoard(
  st: Sticker,
  place: { x: number, y: number, w: number, h: number },
  board: { w: number, h: number },
  trueW: number,
  trueH: number,
): Sticker {
  const aspect = trueW / trueH
  const r = stickerRect(place, st, trueW, trueH, aspect)
  const unit = Math.min(board.w, board.h)
  return {
    ...st,
    x: (r.x + r.w / 2) / board.w,
    y: (r.y + r.h / 2) / board.h,
    s: unit > 0 ? r.w / unit : st.s,
  }
}

export function photoNorm(
  place: { x: number, y: number, w: number, h: number },
  canvasX: number,
  canvasY: number,
): { x: number, y: number } {
  return {
    x: (canvasX - place.x) / place.w,
    y: (canvasY - place.y) / place.h,
  }
}
