export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Sticker {
  id: string
  photoId: string
  x: number
  y: number
  s: number
}

export interface PaneLabel {
  text: string
  font: string
  x: number
  y: number
  size: number
}

export interface Leaf {
  type: 'leaf'
  id: string
  photoId: string | null
  zoom: number
  cx: number
  cy: number
  stickers: Sticker[]
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
export const uid = (p: string) => `${p}${(++seq).toString(36)}`

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

export const DEFAULT_LABEL_SIZE = 42

export function newLabel(): PaneLabel {
  return { text: 'Label', font: '', x: 0.5, y: 0.5, size: DEFAULT_LABEL_SIZE }
}

// Shared by preview and export: white-box rect for a label, centered on (lab.x, lab.y),
// padded proportionally to the font size.
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

export function neighborLeaf(
  leaves: { node: Leaf, rect: Rect }[],
  from: Rect,
  dir: FocusDir,
): Leaf | null {
  let best: { node: Leaf, rect: Rect } | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const l of leaves) {
    const r = l.rect
    let main = 0
    let cross = 0
    if (dir === 'right' || dir === 'left') {
      main = dir === 'right' ? r.x - (from.x + from.w) : from.x - (r.x + r.w)
      if (main < -1)
        continue
      cross = Math.max(0, Math.max(from.y, r.y) - Math.min(from.y + from.h, r.y + r.h))
    }
    else {
      main = dir === 'down' ? r.y - (from.y + from.h) : from.y - (r.y + r.h)
      if (main < -1)
        continue
      cross = Math.max(0, Math.max(from.x, r.x) - Math.min(from.x + from.w, r.x + r.w))
    }
    const score = Math.max(0, main) + cross * 4
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

function walk(node: Node, rect: Rect, gap: number, out: TreeLayout) {
  if (node.type === 'leaf') {
    out.leaves.push({ node, rect })
    return
  }
  out.dividers.push({ id: node.id, dir: node.dir, area: rect, ratio: node.ratio })

  if (node.dir === 'row') {
    const avail = Math.max(0, rect.w - gap)
    const aw = avail * node.ratio
    walk(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }, gap, out)
    walk(node.b, { x: rect.x + aw + gap, y: rect.y, w: avail - aw, h: rect.h }, gap, out)
  }
  else {
    const avail = Math.max(0, rect.h - gap)
    const ah = avail * node.ratio
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
