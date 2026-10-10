import type { Photo } from './lib/imageStore'
import type { Divider, FocusDir, Leaf, Node, PaneLabel, Sticker } from './lib/panes'
import { create } from 'zustand'
import { looksHeic, probeHeic } from './lib/heic'
import { clearImageCaches, probeJpeg } from './lib/imageStore'
import { baseKey, splitLiveFiles } from './lib/livephoto'
import {

  findLeaf,
  layoutTree,

  leafList,
  neighborLeaf,
  newLabel,

  newLeaf,
  removeLeaf,
  setSplitRatioIn,
  splitLeaf,

  uid,
  updateLeafIn,
} from './lib/panes'

export interface State {
  photos: Photo[]
  root: Node
  focusId: string
  canvasRatio: number | null
  canvasFill: number
  gap: number
  radius: number
  bg: string
  longSide: number
  format: 'image/jpeg' | 'image/png'
  quality: number
  stickerPick: { paneId: string, x: number, y: number } | null
  labelSel: string | null
}

interface Actions {
  addPhotos: (files: File[], autoFill?: boolean) => Photo[]
  clearLibrary: () => void
  split: (paneId: string, dir: 'row' | 'column') => void
  closePane: (paneId: string) => void
  resizeSplit: (splitId: string, ratio: number) => void
  assign: (paneId: string, photoId: string) => void
  removePhoto: (paneId: string) => void
  swapPhotos: (a: string, b: string) => void
  updateLeaf: (paneId: string, patch: Partial<Leaf>) => void
  focus: (paneId: string) => void
  focusNeighbor: (dir: FocusDir) => void
  selectLabel: (paneId: string | null) => void
  autoFill: () => void
  patch: (p: Partial<State>) => void
  setCanvasSize: (ratio: number, fill: number) => void
  beginStickerPick: (paneId: string, x: number, y: number) => void
  cancelStickerPick: () => void
  addSticker: (paneId: string, photoId: string) => void
  moveSticker: (paneId: string, stickerId: string, x: number, y: number) => void
  scaleSticker: (paneId: string, stickerId: string, s: number) => void
  removeSticker: (paneId: string, stickerId: string) => void
  ensureLabel: (paneId: string) => void
  setLabel: (paneId: string, patch: Partial<PaneLabel>) => void
  removeLabel: (paneId: string) => void
}

export const GAP = 0
export const RADIUS = 0
export const BG = '#ffffff'
export const MIN_PANE_PX = 56
export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 8

export const BG_PRESETS: { id: string, label: string, value: string }[] = [
  { id: 'black', label: 'Black', value: '#000000' },
  { id: 'white', label: 'White', value: '#ffffff' },
  { id: 'transparent', label: 'Transparent', value: 'transparent' },
]

export const isTransparentBg = (bg: string) => bg === 'transparent'

const defaultRoot = newLeaf()

export const useStore = create<State & Actions>((set, get) => ({
  photos: [],
  root: defaultRoot,
  focusId: defaultRoot.id,
  canvasRatio: null,
  canvasFill: 1,
  gap: GAP,
  radius: RADIUS,
  bg: BG,
  longSide: 2048,
  format: 'image/jpeg',
  quality: 0.92,
  stickerPick: null,
  labelSel: null,

  addPhotos: (files, autoFill = true) => {
    const { images, videos } = splitLiveFiles(files)
    const vids = new Map<string, File>()
    for (const v of videos) {
      const k = baseKey(v.name)
      if (!vids.has(k))
        vids.set(k, v)
    }
    const imgs = images.filter(f => f.type.startsWith('image/') || looksHeic(f))
    if (!imgs.length && !vids.size)
      return []
    imgs.sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, {
        numeric: true,
      }),
    )
    const stamp = Date.now().toString(36)
    const added: Photo[] = imgs.map((f, i) => ({
      id: `${stamp}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      file: f,
      videoFile: vids.get(baseKey(f.name)),
      trueW: 0,
      trueH: 0,
    }))
    // A MOV dropped on its own glues onto an already-imported still with the
    // same basename (Finder / Photos exports arrive as HEIC + MOV pairs).
    set(s => ({
      photos: [
        ...s.photos.map(p => (!p.videoFile && vids.get(baseKey(p.name))
          ? { ...p, videoFile: vids.get(baseKey(p.name)) }
          : p)),
        ...added,
      ],
    }))

    added.forEach(async (p) => {
      const d = await (looksHeic(p.file) ? probeHeic(p.file) : probeJpeg(p.file))
      if (!d)
        return
      set(s => ({
        photos: s.photos.map(x => (x.id === p.id ? { ...x, trueW: d.w, trueH: d.h } : x)),
        canvasRatio: s.canvasRatio ?? d.w / d.h,
      }))
    })

    if (autoFill && leafList(get().root).every(l => !l.photoId))
      get().autoFill()
    return added
  },

  clearLibrary: () => {
    clearImageCaches()
    const fresh = newLeaf()
    set(s => ({
      photos: [],
      root: fresh,
      focusId: fresh.id,
      canvasRatio: null,
      canvasFill: 1,
      gap: s.gap,
      radius: s.radius,
      bg: s.bg,
      labelSel: null,
    }))
  },

  split: (paneId, dir) =>
    set((s) => {
      const next = splitLeaf(s.root, paneId, dir)
      if (next === s.root)
        return {}
      const leaves = leafList(next)
      const created = leaves.find(l => !leafList(s.root).some(o => o.id === l.id))
      return { root: next, focusId: created?.id ?? s.focusId }
    }),

  closePane: paneId =>
    set((s) => {
      const next = removeLeaf(s.root, paneId)
      if (!next || next === s.root)
        return {}
      const leaves = leafList(next)
      return {
        root: next,
        focusId: leaves.some(l => l.id === s.focusId) ? s.focusId : leaves[0].id,
        labelSel: s.labelSel === paneId ? null : s.labelSel,
      }
    }),

  resizeSplit: (splitId, ratio) => set(s => ({ root: setSplitRatioIn(s.root, splitId, ratio) })),

  removePhoto: paneId =>
    set(s => ({
      root: updateLeafIn(s.root, paneId, { photoId: null, zoom: 1, cx: 0.5, cy: 0.5, stickers: [] }),
    })),

  swapPhotos: (a, b) =>
    set((s) => {
      const la = findLeaf(s.root, a)
      const lb = findLeaf(s.root, b)
      if (!la || !lb)
        return s
      let root = updateLeafIn(s.root, a, {
        photoId: lb.photoId,
        zoom: lb.zoom,
        cx: lb.cx,
        cy: lb.cy,
        stickers: lb.stickers,
      })
      root = updateLeafIn(root, b, {
        photoId: la.photoId,
        zoom: la.zoom,
        cx: la.cx,
        cy: la.cy,
        stickers: la.stickers,
      })
      return { root }
    }),

  assign: (paneId, photoId) =>
    set(s => ({
      root: updateLeafIn(s.root, paneId, {
        photoId,
        zoom: 1,
        cx: 0.5,
        cy: 0.5,
        stickers: [],
      }),
      focusId: paneId,
    })),

  updateLeaf: (paneId, patch) => set(s => ({ root: updateLeafIn(s.root, paneId, patch) })),

  focus: paneId => set({ focusId: paneId }),
  focusNeighbor: (dir) => {
    const s = get()
    if (!s.focusId)
      return
    const W = 1200
    const H = Math.round(W / (s.canvasRatio ?? 1.5))
    const { leaves } = layoutTree(s.root, W, H, 1)
    const cur = leaves.find(l => l.node.id === s.focusId)
    if (!cur)
      return
    const next = neighborLeaf(
      leaves.filter(l => l.node.id !== s.focusId),
      cur.rect,
      dir,
    )
    if (next)
      set({ focusId: next.id })
  },

  selectLabel: paneId => set({ labelSel: paneId }),

  autoFill: () =>
    set((s) => {
      if (!s.photos.length)
        return {}
      let k = 0
      let next = s.root
      for (const leaf of leafList(s.root)) {
        if (leaf.photoId)
          continue
        const p = s.photos[k++ % s.photos.length]
        next = updateLeafIn(next, leaf.id, { photoId: p.id, zoom: 1, cx: 0.5, cy: 0.5 })
      }
      return { root: next }
    }),

  patch: p => set(p),

  setCanvasSize: (ratio, fill) =>
    set({
      canvasRatio: Math.min(8, Math.max(0.12, ratio)),
      canvasFill: Math.min(1, Math.max(0.15, fill)),
    }),

  beginStickerPick: (paneId, x, y) => set({ stickerPick: { paneId, x, y } }),

  cancelStickerPick: () => set({ stickerPick: null }),

  addSticker: (paneId, photoId) =>
    set((s) => {
      const pane = findLeaf(s.root, paneId)
      if (!pane?.photoId)
        return {}
      const at
        = s.stickerPick?.paneId === paneId ? s.stickerPick : { paneId, x: 0.5, y: 0.5 }
      const st: Sticker = { id: uid('t'), photoId, x: at.x, y: at.y, s: 0.25 }
      return {
        root: updateLeafIn(s.root, paneId, { stickers: [...pane.stickers, st] }),
        stickerPick: { paneId, x: at.x, y: at.y },
      }
    }),

  moveSticker: (paneId, stickerId, x, y) =>
    set(s => ({
      root: patchStickerIn(s.root, paneId, stickerId, st => ({ ...st, x, y })),
    })),

  scaleSticker: (paneId, stickerId, sVal) =>
    set(s => ({
      root: patchStickerIn(s.root, paneId, stickerId, st => ({
        ...st,
        s: Math.min(1.5, Math.max(0.02, sVal)),
      })),
    })),

  removeSticker: (paneId, stickerId) =>
    set((s) => {
      const pane = findLeaf(s.root, paneId)
      if (!pane)
        return {}
      return {
        root: updateLeafIn(s.root, paneId, {
          stickers: pane.stickers.filter(t => t.id !== stickerId),
        }),
      }
    }),

  ensureLabel: paneId =>
    set((s) => {
      const pane = findLeaf(s.root, paneId)
      if (!pane)
        return {}
      if (pane.label)
        return { labelSel: paneId }
      return { root: updateLeafIn(s.root, paneId, { label: newLabel() }), labelSel: paneId }
    }),

  setLabel: (paneId, patch) =>
    set((s) => {
      const pane = findLeaf(s.root, paneId)
      if (!pane?.label)
        return {}
      const label: PaneLabel = { ...pane.label, ...patch }
      if (patch.size !== undefined)
        label.size = Math.min(160, Math.max(12, patch.size))
      return { root: updateLeafIn(s.root, paneId, { label }) }
    }),

  removeLabel: paneId =>
    set(s => ({
      root: updateLeafIn(s.root, paneId, { label: null }),
      labelSel: s.labelSel === paneId ? null : s.labelSel,
    })),
}))

function patchStickerIn(
  root: Node,
  paneId: string,
  stickerId: string,
  fn: (st: Sticker) => Sticker,
): Node {
  const pane = findLeaf(root, paneId)
  if (!pane)
    return root
  return updateLeafIn(root, paneId, {
    stickers: pane.stickers.map(t => (t.id === stickerId ? fn(t) : t)),
  })
}

export const photoMap = (photos: Photo[]) => new Map(photos.map(p => [p.id, p]))

export interface Derived {
  W: number
  H: number
  leaves: { node: Leaf, rect: { x: number, y: number, w: number, h: number } }[]
  dividers: Divider[]
  gap: number
  radius: number
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
): Derived {
  const fit = fitCanvas(canvasRatio, availW, availH)
  const W = Math.max(80, Math.round(fit.W * canvasFill))
  const H = Math.max(80, Math.round(fit.H * canvasFill))
  const u = Math.min(W, H) / 1000
  const gap = gapValue * u
  const l = layoutTree(root, W, H, gap)
  return { W, H, leaves: l.leaves, dividers: l.dividers, gap, radius: radiusValue * u, unit: u }
}
