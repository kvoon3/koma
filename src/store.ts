import type { Photo } from './lib/imageStore'
import type { Divider, FocusDir, Leaf, Node, PaneLabel, Sticker } from './lib/panes'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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
import { viewTransition } from './lib/viewTransition'

/** One of the nine collage workspaces. Array order is the grid order. */
export interface Workspace {
  id: string
  root: Node
  focusId: string
  canvasRatio: number | null
  canvasFill: number
}

export interface State {
  photos: Photo[]
  workspaces: Workspace[]
  activeId: string
  /** 'edit' shows the active workspace canvas; 'grid' shows the 3×3 overview. */
  view: 'edit' | 'grid'
  /** The workspace the G key / center button returns to (tracked by id, not position). */
  gap: number
  radius: number
  bg: string
  longSide: number
  format: 'image/jpeg' | 'image/png'
  quality: number
  labelSel: string | null
  /** Selected sticker; selecting one clears labelSel and vice versa. */
  stickerSel: { paneId: string, stickerId: string } | null
  /**
   * Set when a tool (not the pane itself) asks a pane's label to enter edit
   * mode; the sequence number lets a pane consume requests render-time, and
   * repeated requests for the same pane still fire.
   */
  labelEditReq: { paneId: string, seq: number } | null
}

export const GAP = 0
export const RADIUS = 0
export const BG = '#000000'
export const MIN_PANE_PX = 56
export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 8

export const isTransparentBg = (bg: string) => bg === 'transparent'

function newWorkspace(): Workspace {
  const root = newLeaf()
  return { id: uid('w'), root, focusId: root.id, canvasRatio: null, canvasFill: 1 }
}

function initialWorkspaces(): Workspace[] {
  return Array.from({ length: 9 }, newWorkspace)
}

const bootWorkspaces = initialWorkspaces()

/** Active workspace (never null: activeId always matches a workspace). */
export function activeWs(s: State): Workspace {
  return s.workspaces.find(w => w.id === s.activeId) ?? s.workspaces[0]
}

/** Map over the active workspace, keeping the array order. */
function mapActive(s: State, fn: (w: Workspace) => Workspace): Workspace[] {
  return s.workspaces.map(w => (w.id === s.activeId ? fn(w) : w))
}

let labelEditSeq = 0

/** Clear selection-type state on any workspace / view switch. */
const clearedSelection = {
  labelSel: null,
  stickerSel: null,
  labelEditReq: null,
}

export const useStore = create<State & Actions>()(persist((set, get) => ({
  photos: [],
  workspaces: bootWorkspaces,
  activeId: bootWorkspaces[0].id,
  view: 'grid' as const,
  gap: GAP,
  radius: RADIUS,
  bg: BG,
  longSide: 2048,
  format: 'image/jpeg',
  quality: 0.92,
  labelSel: null,
  stickerSel: null,
  labelEditReq: null,

  addPhotos: (files, autoFill = true) => {
    const { images, videos } = splitLiveFiles(files)
    const vids = new Map<string, File>()
    for (const v of videos) {
      const k = baseKey(v.name)
      if (k && !vids.has(k))
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
        // Auto-set the aspect ratio of the ACTIVE workspace only, and only
        // while it is still unset.
        workspaces: s.workspaces.map(w => (w.id === s.activeId && w.canvasRatio == null
          ? { ...w, canvasRatio: d.w / d.h }
          : w)),
      }))
    })

    if (autoFill && leafList(activeWs(get()).root).every(l => !l.photoId))
      get().autoFill()
    return added
  },

  clearLibrary: () => {
    clearImageCaches()
    set(s => ({
      photos: [],
      // Reset every workspace to a fresh blank canvas, keeping the order.
      workspaces: s.workspaces.map(() => newWorkspace()),
      labelSel: null,
      stickerSel: null,
      labelEditReq: null,
    }))
  },

  split: (paneId, dir) =>
    set((s) => {
      const ws = activeWs(s)
      const next = splitLeaf(ws.root, paneId, dir)
      if (next === ws.root)
        return {}
      const leaves = leafList(next)
      const created = leaves.find(l => !leafList(ws.root).some(o => o.id === l.id))
      return {
        workspaces: mapActive(s, w => ({
          ...w,
          root: next,
          focusId: created?.id ?? w.focusId,
        })),
      }
    }),

  closePane: paneId =>
    set((s) => {
      const ws = activeWs(s)
      const next = removeLeaf(ws.root, paneId)
      if (!next || next === ws.root)
        return {}
      const leaves = leafList(next)
      return {
        workspaces: mapActive(s, w => ({
          ...w,
          root: next,
          focusId: leaves.some(l => l.id === w.focusId) ? w.focusId : leaves[0].id,
          labelSel: s.labelSel === paneId ? null : s.labelSel,
          stickerSel: s.stickerSel?.paneId === paneId ? null : s.stickerSel,
        })),
      }
    }),

  resizeSplit: (splitId, ratio) =>
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, root: setSplitRatioIn(w.root, splitId, ratio) })),
    })),

  removePhoto: paneId =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        root: updateLeafIn(w.root, paneId, { photoId: null, zoom: 1, cx: 0.5, cy: 0.5, stickers: [] }),
      })),
      stickerSel: s.stickerSel?.paneId === paneId ? null : s.stickerSel,
    })),

  swapPhotos: (a, b) =>
    set((s) => {
      const ws = activeWs(s)
      const la = findLeaf(ws.root, a)
      const lb = findLeaf(ws.root, b)
      if (!la || !lb)
        return s
      let root = updateLeafIn(ws.root, a, {
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
      return { workspaces: mapActive(s, w => ({ ...w, root })) }
    }),

  assign: (paneId, photoId) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        root: updateLeafIn(w.root, paneId, {
          photoId,
          zoom: 1,
          cx: 0.5,
          cy: 0.5,
          stickers: [],
        }),
        focusId: paneId,
      })),
    })),

  updateLeaf: (paneId, patch) =>
    set(s => ({ workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, patch) })) })),

  focus: paneId => set(s => ({ workspaces: mapActive(s, w => ({ ...w, focusId: paneId })) })),

  focusNeighbor: (dir) => {
    const s = get()
    const ws = activeWs(s)
    if (!ws.focusId)
      return
    const W = 1200
    const H = Math.round(W / (ws.canvasRatio ?? 1.5))
    const { leaves } = layoutTree(ws.root, W, H, 1)
    const cur = leaves.find(l => l.node.id === ws.focusId)
    if (!cur)
      return
    const next = neighborLeaf(
      leaves.filter(l => l.node.id !== ws.focusId),
      cur.rect,
      dir,
    )
    if (next)
      set({ workspaces: mapActive(s, w => ({ ...w, focusId: next.id })) })
  },

  selectLabel: paneId => set({ labelSel: paneId, stickerSel: null }),
  selectSticker: sel => set({ stickerSel: sel, labelSel: null }),
  requestLabelEdit: paneId => set({ labelEditReq: { paneId, seq: ++labelEditSeq } }),

  autoFill: () =>
    set((s) => {
      if (!s.photos.length)
        return {}
      let k = 0
      const ws = activeWs(s)
      let next = ws.root
      for (const leaf of leafList(ws.root)) {
        if (leaf.photoId)
          continue
        const p = s.photos[k++ % s.photos.length]
        next = updateLeafIn(next, leaf.id, { photoId: p.id, zoom: 1, cx: 0.5, cy: 0.5 })
      }
      return { workspaces: mapActive(s, w => (w.id === ws.id ? { ...w, root: next } : w)) }
    }),

  patch: p => set(p),

  setCanvasSize: (ratio, fill) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        canvasRatio: Math.min(8, Math.max(0.12, ratio)),
        canvasFill: Math.min(1, Math.max(0.15, fill)),
      })),
    })),

  /** Enter a workspace in edit view (clicking a grid cell). */
  enterWorkspace: id =>
    viewTransition(() =>
      set(s => ({
        activeId: s.workspaces.some(w => w.id === id) ? id : s.activeId,
        view: 'edit',
        ...clearedSelection,
      }))),

  /** Toggle between the edit canvas and the 3×3 grid overview. */
  toggleGrid: () =>
    viewTransition(() =>
      set(s => ({
        view: s.view === 'grid' ? 'edit' : 'grid',
        ...clearedSelection,
      }))),

  /** Insert-shift reorder: remove `id` from its slot and splice it at `to`. */
  moveWorkspace: (id, to) =>
    set((s) => {
      const from = s.workspaces.findIndex(w => w.id === id)
      if (from === -1 || to < 0 || to > 8 || from === to)
        return {}
      const next = [...s.workspaces]
      const [ws] = next.splice(from, 1)
      next.splice(to, 0, ws)
      return { workspaces: next }
    }),

  addSticker: (paneId, photoId, x, y) =>
    set((s) => {
      const ws = activeWs(s)
      const pane = findLeaf(ws.root, paneId)
      if (!pane?.photoId)
        return {}
      const st: Sticker = { id: uid('t'), photoId, x, y, s: 0.25 }
      return {
        workspaces: mapActive(s, w => ({
          ...w,
          root: updateLeafIn(w.root, paneId, { stickers: [...pane.stickers, st] }),
        })),
      }
    }),

  moveSticker: (paneId, stickerId, x, y) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        root: patchStickerIn(w.root, paneId, stickerId, st => ({ ...st, x, y })),
      })),
    })),

  scaleSticker: (paneId, stickerId, sVal) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        root: patchStickerIn(w.root, paneId, stickerId, st => ({
          ...st,
          s: Math.min(1.5, Math.max(0.02, sVal)),
        })),
      })),
    })),

  removeSticker: (paneId, stickerId) =>
    set((s) => {
      const ws = activeWs(s)
      const pane = findLeaf(ws.root, paneId)
      if (!pane)
        return {}
      return {
        workspaces: mapActive(s, w => ({
          ...w,
          root: updateLeafIn(w.root, paneId, {
            stickers: pane.stickers.filter(t => t.id !== stickerId),
          }),
        })),
        stickerSel: s.stickerSel?.paneId === paneId && s.stickerSel.stickerId === stickerId
          ? null
          : s.stickerSel,
      }
    }),

  ensureLabel: paneId =>
    set((s) => {
      const ws = activeWs(s)
      const pane = findLeaf(ws.root, paneId)
      if (!pane)
        return {}
      if (pane.label)
        return { labelSel: paneId }
      return {
        workspaces: mapActive(s, w => ({
          ...w,
          root: updateLeafIn(w.root, paneId, { label: newLabel() }),
        })),
        labelSel: paneId,
      }
    }),

  setLabel: (paneId, patch) =>
    set((s) => {
      const ws = activeWs(s)
      const pane = findLeaf(ws.root, paneId)
      if (!pane?.label)
        return {}
      const label: PaneLabel = { ...pane.label, ...patch }
      if (patch.size !== undefined)
        label.size = Math.min(160, Math.max(12, patch.size))
      return {
        workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, { label }) })),
      }
    }),

  removeLabel: paneId =>
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, { label: null }) })),
      labelSel: s.labelSel === paneId ? null : s.labelSel,
    })),
}), {
  // Visual settings survive reloads; the rest of the state (workspaces,
  // photos) stays session-only.
  name: 'collage:settings',
  partialize: state => ({ gap: state.gap, radius: state.radius, bg: state.bg }),
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
  selectSticker: (sel: { paneId: string, stickerId: string } | null) => void
  requestLabelEdit: (paneId: string) => void
  autoFill: () => void
  patch: (p: Partial<State>) => void
  setCanvasSize: (ratio: number, fill: number) => void
  enterWorkspace: (id: string) => void
  toggleGrid: () => void
  moveWorkspace: (id: string, to: number) => void
  addSticker: (paneId: string, photoId: string, x: number, y: number) => void
  moveSticker: (paneId: string, stickerId: string, x: number, y: number) => void
  scaleSticker: (paneId: string, stickerId: string, s: number) => void
  removeSticker: (paneId: string, stickerId: string) => void
  ensureLabel: (paneId: string) => void
  setLabel: (paneId: string, patch: Partial<PaneLabel>) => void
  removeLabel: (paneId: string) => void
}
