/**
 * The pure layout math behind the stage: the canvas fit, the derived pane
 * rectangles / dividers the view draws from, and the lift that moves a legacy
 * pane's stickers and label onto the board. No store access: geometry is a
 * function of the tree alone, so it can be reasoned about (and measured)
 * without booting the store.
 */
import type { Workspace } from '../store'
import type { Photo } from './imageStore'
import type { Divider, Leaf, Node, PaneLabel, Sticker } from './panes'
import { layoutTree, leafList, placement, stickerToBoard, uid, updateLeafIn } from './panes'

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
  const fit = fitCanvas(canvasRatio, availW, availH)
  const W = Math.max(80, Math.round(fit.W * canvasFill))
  const H = Math.max(80, Math.round(fit.H * canvasFill))
  const u = Math.min(W, H) / 1000
  const gap = gapValue * u
  const l = layoutTree(root, W, H, gap)
  return { W, H, leaves: l.leaves, dividers: l.dividers, gap, radius: radiusValue * u, fade: fadeValue * u, unit: u }
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
