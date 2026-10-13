import type { Photo } from './lib/imageStore'
import type { Divider, FocusDir, Leaf, Node, PaneLabel, Sticker } from './lib/panes'
import type { SessionMeta } from './lib/sessionStore'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { looksHeic, probeHeic } from './lib/heic'
import { clearImageCaches, probeJpeg, probePng } from './lib/imageStore'
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
import { clearSession } from './lib/sessionStore'

/** One of the nine collage workspaces. Array order is the grid order. */
export interface Workspace {
  id: string
  root: Node
  focusId: string
  canvasRatio: number | null
  canvasFill: number
}

/** The pane contents the menu's copy / paste pair carries: everything a leaf holds. */
export interface PaneClip {
  photoId: string | null
  zoom: number
  cx: number
  cy: number
  stickers: Sticker[]
  label: PaneLabel | null
}

export interface State {
  photos: Photo[]
  workspaces: Workspace[]
  activeId: string
  /** The workspace the G key / center button returns to (tracked by id, not position). */
  gap: number
  /** Space between the nine overview cells, in px (grid view only). */
  gridGap: number
  radius: number
  bg: string
  edgeFade: number
  edgeFadeStrength: number
  paneBorder: boolean
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
  /**
   * Whether the tools panel (Stage's overlay) is pulled open. It starts open,
   * and only its handle changes it: moving the focus never touches it, so a
   * manual collapse sticks.
   */
  toolsOpen: boolean
  /**
   * Copied pane contents for the menu's paste item, session-only so a reload
   * forgets it. Pasting clones the stickers under fresh ids.
   */
  paneClip: PaneClip | null
  /**
   * The pane whose sticker maker dialog is open. A store field instead of
   * Stage's own state because the pane menu opens the dialog too.
   */
  stickerMakerFor: string | null
}

export const GAP = 0
export const GRID_GAP = 10
export const RADIUS = 0
export const BG = '#000000'
export const EDGE_FADE = 60
export const EDGE_FADE_STRENGTH = 100
export const PANE_BORDER = false
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
  stickerMakerFor: null,
}

export const useStore = create<State & Actions>()(persist((set, get) => ({
  photos: [],
  workspaces: bootWorkspaces,
  activeId: bootWorkspaces[0].id,
  gap: GAP,
  gridGap: GRID_GAP,
  radius: RADIUS,
  bg: BG,
  edgeFade: EDGE_FADE,
  edgeFadeStrength: EDGE_FADE_STRENGTH,
  paneBorder: PANE_BORDER,
  longSide: 2048,
  format: 'image/jpeg',
  quality: 0.92,
  labelSel: null,
  stickerSel: null,
  labelEditReq: null,
  toolsOpen: true,
  paneClip: null,
  stickerMakerFor: null,

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
      const d = (await (looksHeic(p.file) ? probeHeic(p.file) : probeJpeg(p.file))) ?? await probePng(p.file)
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
    void clearSession()
    set(s => ({
      photos: [],
      // Reset every workspace to a fresh blank canvas, keeping each id and its
      // grid slot: `activeId` and `mapActive` key off those ids, so handing out
      // new ones would leave every later pane action pointed at nothing.
      workspaces: s.workspaces.map(w => ({ ...newWorkspace(), id: w.id })),
      labelSel: null,
      stickerSel: null,
      labelEditReq: null,
      // The clipboard points at photos that no longer exist.
      paneClip: null,
      stickerMakerFor: null,
    }))
  },

  /**
   * Reset one workspace to a fresh blank canvas, keeping its id and grid
   * slot (the photos fall back to the library; everything else is untouched).
   */
  resetWorkspace: id =>
    set(s => ({
      workspaces: s.workspaces.map(w => (w.id === id ? { ...newWorkspace(), id: w.id } : w)),
      ...clearedSelection,
    })),

  /**
   * Reset every workspace to a fresh blank canvas, keeping their ids and
   * grid slots (photos fall back to the library; the board itself stays).
   */
  resetAllWorkspaces: () =>
    set(s => ({
      workspaces: s.workspaces.map(w => ({ ...newWorkspace(), id: w.id })),
      ...clearedSelection,
    })),

  /** Restore a session saved by `lib/sessionStore` (refresh-safe autosave). */
  hydrate: (session) => {
    set({
      ...session.meta,
      photos: session.photos,
      labelSel: null,
      stickerSel: null,
      labelEditReq: null,
      paneClip: null,
      stickerMakerFor: null,
    })
    // Re-probe photos whose header scan never finished before the page
    // closed (trueW/trueH drive export placement and the crop report).
    for (const p of session.photos) {
      if (p.trueW > 0)
        continue
      void ((looksHeic(p.file) ? probeHeic(p.file) : probeJpeg(p.file)).then(d => d ?? probePng(p.file))).then((d) => {
        if (!d)
          return
        set(s => ({
          photos: s.photos.map(x => (x.id === p.id ? { ...x, trueW: d.w, trueH: d.h } : x)),
        }))
      })
    }
  },

  split: (paneId, dir) =>
    set((s) => {
      const ws = activeWs(s)
      const next = splitLeaf(ws.root, paneId, dir)
      if (next === ws.root)
        return {}
      const leaves = leafList(next)
      const created = leaves.find(l => !leafList(ws.root).some(o => o.id === l.id))
      const focusId = created?.id ?? ws.focusId
      return { workspaces: mapActive(s, w => ({ ...w, root: next, focusId })) }
    }),

  /** Split `paneId` and copy its whole leaf (photo, view, stickers, label) into the new half. */
  duplicatePane: (paneId, dir) =>
    set((s) => {
      const ws = activeWs(s)
      const src = findLeaf(ws.root, paneId)
      if (!src)
        return {}
      const next = splitLeaf(ws.root, paneId, dir)
      if (next === ws.root)
        return {}
      const created = leafList(next).find(l => !leafList(ws.root).some(o => o.id === l.id))
      if (!created)
        return {}
      const root = updateLeafIn(next, created.id, {
        photoId: src.photoId,
        zoom: src.zoom,
        cx: src.cx,
        cy: src.cy,
        // Fresh sticker ids: two panes must never share one selection.
        stickers: src.stickers.map(st => ({ ...st, id: uid('t') })),
        label: src.label ? { ...src.label } : null,
      })
      return { workspaces: mapActive(s, w => ({ ...w, root, focusId: created.id })) }
    }),

  /** Empty one pane back to a blank half of the canvas (label and stickers included). */
  resetPane: paneId =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        root: updateLeafIn(w.root, paneId, {
          photoId: null,
          zoom: 1,
          cx: 0.5,
          cy: 0.5,
          stickers: [],
          label: null,
        }),
      })),
      labelSel: s.labelSel === paneId ? null : s.labelSel,
      stickerSel: s.stickerSel?.paneId === paneId ? null : s.stickerSel,
    })),

  copyPane: paneId =>
    set((s) => {
      const leaf = findLeaf(activeWs(s).root, paneId)
      if (!leaf)
        return {}
      return {
        paneClip: {
          photoId: leaf.photoId,
          zoom: leaf.zoom,
          cx: leaf.cx,
          cy: leaf.cy,
          stickers: leaf.stickers.map(st => ({ ...st })),
          label: leaf.label ? { ...leaf.label } : null,
        },
      }
    }),

  pastePane: paneId =>
    set((s) => {
      const clip = s.paneClip
      if (!clip)
        return {}
      return {
        workspaces: mapActive(s, w => ({
          ...w,
          root: updateLeafIn(w.root, paneId, {
            photoId: clip.photoId,
            zoom: clip.zoom,
            cx: clip.cx,
            cy: clip.cy,
            // Like duplicate: the pasted stickers are a second copy, not a share.
            stickers: clip.stickers.map(st => ({ ...st, id: uid('t') })),
            label: clip.label ? { ...clip.label } : null,
          }),
          focusId: paneId,
        })),
      }
    }),

  closeOtherPanes: paneId =>
    set((s) => {
      const ws = activeWs(s)
      if (!findLeaf(ws.root, paneId))
        return {}
      let root: Node | null = ws.root
      for (const l of leafList(ws.root)) {
        if (l.id !== paneId)
          root = root ? removeLeaf(root, l.id) : null
      }
      if (!root)
        return {}
      const next = root
      return {
        workspaces: mapActive(s, w => ({ ...w, root: next, focusId: paneId })),
        ...clearedSelection,
      }
    }),

  /** Close every pane without a photo; a no-op when that would empty the canvas. */
  closeEmptyPanes: () =>
    set((s) => {
      const ws = activeWs(s)
      let root: Node | null = ws.root
      for (const l of leafList(ws.root)) {
        if (!l.photoId)
          root = root ? removeLeaf(root, l.id) : null
      }
      if (!root || root === ws.root)
        return {}
      const next = root
      const leaves = leafList(next)
      const focusId = leaves.some(l => l.id === ws.focusId) ? ws.focusId : leaves[0].id
      return {
        workspaces: mapActive(s, w => ({ ...w, root: next, focusId })),
        ...clearedSelection,
      }
    }),

  openStickerMaker: paneId => set({ stickerMakerFor: paneId }),

  closePane: paneId =>
    set((s) => {
      const ws = activeWs(s)
      const next = removeLeaf(ws.root, paneId)
      if (!next || next === ws.root)
        return {}
      const leaves = leafList(next)
      const focusId = leaves.some(l => l.id === ws.focusId) ? ws.focusId : leaves[0].id
      return {
        workspaces: mapActive(s, w => ({
          ...w,
          root: next,
          focusId,
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

  focus: paneId => set(s => ({
    workspaces: mapActive(s, w => ({ ...w, focusId: paneId })),
  })),

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
  setToolsOpen: open => set({ toolsOpen: open }),

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

  // The settings drawer's Reset: every visual knob back to its default. The
  // font mirror is not in the store (it lives in lib/fonts), so the drawer
  // resets that one itself.
  resetSettings: () =>
    set({
      gap: GAP,
      gridGap: GRID_GAP,
      radius: RADIUS,
      bg: BG,
      edgeFade: EDGE_FADE,
      edgeFadeStrength: EDGE_FADE_STRENGTH,
      paneBorder: PANE_BORDER,
    }),

  setCanvasSize: (ratio, fill) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        canvasRatio: Math.min(8, Math.max(0.12, ratio)),
        canvasFill: Math.min(1, Math.max(0.15, fill)),
      })),
    })),

  /** Clear selection-type state on any workspace / view switch. */
  clearSelection: () => set({ ...clearedSelection }),

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
  partialize: state => ({
    gap: state.gap,
    gridGap: state.gridGap,
    radius: state.radius,
    bg: state.bg,
    edgeFade: state.edgeFade,
    edgeFadeStrength: state.edgeFadeStrength,
    paneBorder: state.paneBorder,
  }),
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

interface Actions {
  addPhotos: (files: File[], autoFill?: boolean) => Photo[]
  duplicatePane: (paneId: string, dir: 'row' | 'column') => void
  resetPane: (paneId: string) => void
  copyPane: (paneId: string) => void
  pastePane: (paneId: string) => void
  closeOtherPanes: (paneId: string) => void
  closeEmptyPanes: () => void
  openStickerMaker: (paneId: string | null) => void
  clearLibrary: () => void
  resetWorkspace: (id: string) => void
  resetAllWorkspaces: () => void
  hydrate: (session: { meta: SessionMeta, photos: Photo[] }) => void
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
  setToolsOpen: (open: boolean) => void
  autoFill: () => void
  patch: (p: Partial<State>) => void
  resetSettings: () => void
  setCanvasSize: (ratio: number, fill: number) => void
  clearSelection: () => void
  moveWorkspace: (id: string, to: number) => void
  addSticker: (paneId: string, photoId: string, x: number, y: number) => void
  moveSticker: (paneId: string, stickerId: string, x: number, y: number) => void
  scaleSticker: (paneId: string, stickerId: string, s: number) => void
  removeSticker: (paneId: string, stickerId: string) => void
  ensureLabel: (paneId: string) => void
  setLabel: (paneId: string, patch: Partial<PaneLabel>) => void
  removeLabel: (paneId: string) => void
}
