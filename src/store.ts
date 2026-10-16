import type { GridCellRatio } from './lib/gridTools'
import type { Photo } from './lib/imageStore'
import type { Divider, FocusDir, Leaf, Node, PaneLabel, Sticker } from './lib/panes'
import type { SessionMeta } from './lib/sessionStore'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearTreePhotos, GRID_CELL_RATIO, isGridCellRatio, shuffleFilled } from './lib/gridTools'
import { looksHeic, probeHeic, warmHeicDecoder } from './lib/heic'
import { clearImageCaches, probeJpeg, probePng } from './lib/imageStore'
import { baseKey, splitLiveFiles } from './lib/livephoto'
import {

  deletePane,
  findLeaf,
  layoutTree,
  leafList,
  neighborLeaf,

  newLabel,
  newLeaf,
  placement,

  removeLeaf,
  setSplitRatioIn,
  splitLeaf,
  stickerToBoard,
  swapLeafContents,

  uid,
  updateLeafIn,
  wrapAngle,
} from './lib/panes'
import { clearSession } from './lib/sessionStore'
import { runPaneMorph } from './lib/viewTransition'
import { activeAfterRemove, addSlot, DEFAULT_WORKSPACES, MAX_WORKSPACES, normalizeSlots, removeSlot, resetSlot } from './lib/workspaces'

/** One of the grid's collage workspaces (1–9 of them). Array order is the grid order. */
export interface Workspace {
  id: string
  root: Node
  focusId: string
  canvasRatio: number | null
  canvasFill: number
  /** Board-level stickers (insert images); coords are canvas-normalized. */
  stickers: Sticker[]
  /** Board-level text labels; coords are canvas-normalized. */
  labels: PaneLabel[]
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

/** Bottom tools sheet snap: hidden / one scrolling row / wrapped multi-row. */
export type ToolsDockMode = 'collapsed' | 'row' | 'expanded'
export type DockBg = 'solid' | 'frosted' | 'liquid'

interface State {
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
  /**
   * Opt-in photo crossfade (overlap + opposing masks + plus-lighter).
   * Off by default: Safari regresses when this is the default blend path.
   */
  blendCrossfade: boolean
  paneBorder: boolean
  longSide: number
  format: 'image/jpeg' | 'image/png'
  quality: number
  labelSel: string | null
  /** Selected sticker; selecting one clears labelSel and vice versa. */
  stickerSel: { stickerId: string } | null
  /**
   * Set when a tool (not the pane itself) asks a pane's label to enter edit
   * mode; the sequence number lets a pane consume requests render-time, and
   * repeated requests for the same pane still fire.
   */
  labelEditReq: { labelId: string, seq: number } | null
  dockBg: DockBg
  /** Aspect of the 3×3 grid's cells (display, snapshot and per-cell export). */
  gridCellRatio: GridCellRatio
  /** Dock background opacity, 0–100 (%). */
  dockOpacity: number
  /**
   * Bottom tools sheet snap state. Persisted; starts collapsed. Drag
   * the handle or tap it to move between collapsed / row / expanded.
   */
  toolsDockMode: ToolsDockMode
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
export const BLEND_CROSSFADE = true
export const PANE_BORDER = false

export const DOCK_BG: DockBg = 'solid'
export const DOCK_OPACITY = 60
export const TOOLS_DOCK_MODE: ToolsDockMode = 'collapsed'

export const SETTINGS_VERSION = 6

const DOCK_BGS: readonly DockBg[] = ['solid', 'frosted', 'liquid']
const DOCK_MODES: readonly ToolsDockMode[] = ['collapsed', 'row', 'expanded']

/** Persisted-settings migration (zustand `persist`); pure for unit tests. */
export function migrateSettings(persisted: unknown, version: number): Record<string, unknown> {
  const p = { ...(persisted as Record<string, unknown> | null ?? {}) }
  if (version < 1)
    p.blendCrossfade = BLEND_CROSSFADE
  // v2: dock background + opacity + handle icon, and the dock mode is now
  // persisted (new and migrated visits start collapsed). Sanitize either way.
  if (version < 2)
    p.toolsDockMode = TOOLS_DOCK_MODE
  // v5: default became solid. Pre-v5 'frosted' was the old default and can't
  // be told from an explicit pick (preview-only), so reset it.
  if (version < 5 && p.dockBg === 'frosted')
    p.dockBg = DOCK_BG
  // v6: grid cell aspect ratio (1:1 default).
  if (!isGridCellRatio(p.gridCellRatio))
    p.gridCellRatio = GRID_CELL_RATIO
  // v4: the 'transparent' dock style is gone; it (and any unknown value)
  // falls back to the default below.
  if (!DOCK_BGS.includes(p.dockBg as DockBg))
    p.dockBg = DOCK_BG
  const op = Number(p.dockOpacity)
  p.dockOpacity = Number.isFinite(op) && p.dockOpacity != null ? Math.min(100, Math.max(0, op)) : DOCK_OPACITY
  // v3: the temporary handle-icon toggle is gone (ruler is fixed).
  delete p.dockHandleIcon
  if (!DOCK_MODES.includes(p.toolsDockMode as ToolsDockMode))
    p.toolsDockMode = TOOLS_DOCK_MODE
  return p
}
export const MIN_PANE_PX = 56
export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 8

export const isTransparentBg = (bg: string) => bg === 'transparent'

function newWorkspace(): Workspace {
  const root = newLeaf()
  return { id: uid('w'), root, focusId: root.id, canvasRatio: null, canvasFill: 1, stickers: [], labels: [] }
}

/** Bring a loaded board within the grid's 1–9 cells (see normalizeSlots). */
export function normalizeWorkspaces(list: Workspace[] | null | undefined): Workspace[] {
  return normalizeSlots(list, newWorkspace)
}

function initialWorkspaces(): Workspace[] {
  return Array.from({ length: DEFAULT_WORKSPACES }, newWorkspace)
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
  blendCrossfade: BLEND_CROSSFADE,
  paneBorder: PANE_BORDER,
  longSide: 2048,
  format: 'image/jpeg',
  quality: 0.92,
  labelSel: null,
  stickerSel: null,
  labelEditReq: null,
  toolsDockMode: TOOLS_DOCK_MODE,
  dockBg: DOCK_BG,
  gridCellRatio: GRID_CELL_RATIO,
  dockOpacity: DOCK_OPACITY,
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
    // Start the (heavy, lazily imported) HEIC decoder before the first pane
    // asks for pixels, so its parse overlaps probing and rendering.
    if (imgs.some(looksHeic))
      warmHeicDecoder()
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

    // `forEach` would drop each probe's promise on the floor. The probes are
    // independent and nothing waits on them, so start one per photo and let the
    // loop finish; each patch lands on its own leaf when it does.
    const probeDims = async (p: Photo) => {
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
    }

    for (const p of added)
      void probeDims(p)

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
      workspaces: resetSlot(s.workspaces, id, newWorkspace),
      ...clearedSelection,
    })),

  /** Append a blank workspace (the grid's + cell); no-op at nine. */
  addWorkspace: () => {
    const before = get().workspaces
    const next = addSlot(before, newWorkspace)
    if (next === before)
      return null
    set({ workspaces: next })
    return next[next.length - 1].id
  },

  /**
   * Remove a workspace from the grid (drag-to-delete); the others close up.
   * The last one is reset in place instead, so there is always a workspace.
   */
  removeWorkspace: id =>
    set((s) => {
      const next = removeSlot(s.workspaces, id, newWorkspace)
      if (next === s.workspaces)
        return {}
      return { workspaces: next, activeId: activeAfterRemove(s.workspaces, next, s.activeId), ...clearedSelection }
    }),

  /**
   * Reset every workspace to a fresh blank canvas, keeping their ids and
   * grid slots (photos fall back to the library; the board itself stays).
   */
  /** Grid Shuffle: randomly reorder the workspaces that hold photos; empty slots stay. */
  shuffleWorkspaces: (rng?: () => number) =>
    set(s => ({ workspaces: shuffleFilled(s.workspaces, w => leafList(w.root).some(l => l.photoId), rng) })),

  /** Grid Clear: drop every photo (panes and board stickers) from all workspaces; layouts stay. */
  clearGridPhotos: () =>
    set(s => ({
      workspaces: s.workspaces.map(w => ({ ...w, root: clearTreePhotos(w.root), stickers: [] })),
      ...clearedSelection,
    })),

  resetAllWorkspaces: () =>
    set(s => ({
      workspaces: s.workspaces.map(w => ({ ...newWorkspace(), id: w.id })),
      ...clearedSelection,
    })),

  /** Restore a session saved by `lib/sessionStore` (refresh-safe autosave). */
  hydrate: (session) => {
    // Saves from the fixed nine-slot board load whole; anything out of the
    // 1–9 range is brought within it (see normalizeSlots).
    const workspaces = normalizeWorkspaces(session.meta.workspaces).map(w =>
      migrateWorkspaceInserts(w, session.photos),
    )
    const activeId = workspaces.some(w => w.id === session.meta.activeId) ? session.meta.activeId : workspaces[0].id
    set({
      ...session.meta,
      workspaces,
      activeId,
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

  split: (paneId, dir) => {
    const s = get()
    const ws = activeWs(s)
    const next = splitLeaf(ws.root, paneId, dir)
    if (next === ws.root)
      return
    const leaves = leafList(next)
    const created = leaves.find(l => !leafList(ws.root).some(o => o.id === l.id))
    const focusId = created?.id ?? ws.focusId
    runPaneMorph([], () =>
      set({ workspaces: mapActive(s, w => ({ ...w, root: next, focusId })) }))
  },

  /** Split `paneId` and copy its whole leaf (photo, view, stickers, label) into the new half. */
  duplicatePane: (paneId, dir) => {
    const s = get()
    const ws = activeWs(s)
    const src = findLeaf(ws.root, paneId)
    if (!src)
      return
    const next = splitLeaf(ws.root, paneId, dir)
    if (next === ws.root)
      return
    const created = leafList(next).find(l => !leafList(ws.root).some(o => o.id === l.id))
    if (!created)
      return
    const root = updateLeafIn(next, created.id, {
      photoId: src.photoId,
      zoom: src.zoom,
      cx: src.cx,
      cy: src.cy,
      stickers: [],
      label: null,
    })
    runPaneMorph([], () =>
      set({ workspaces: mapActive(s, w => ({ ...w, root, focusId: created.id })) }))
  },

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
          stickers: [],
          label: null,
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
            stickers: [],
            label: null,
          }),
          focusId: paneId,
        })),
      }
    }),

  closeOtherPanes: (paneId) => {
    const s = get()
    const ws = activeWs(s)
    if (!findLeaf(ws.root, paneId))
      return
    const others = leafList(ws.root).filter(l => l.id !== paneId)
    let root: Node | null = ws.root
    for (const l of others)
      root = root ? removeLeaf(root, l.id) : null
    if (!root)
      return
    const next = root
    runPaneMorph(others.map(l => l.id), () =>
      set({
        workspaces: mapActive(s, w => ({ ...w, root: next, focusId: paneId })),
        ...clearedSelection,
      }))
  },

  /** Close every pane without a photo; a no-op when that would empty the canvas. */
  closeEmptyPanes: () => {
    const s = get()
    const ws = activeWs(s)
    const empty = leafList(ws.root).filter(l => !l.photoId)
    let root: Node | null = ws.root
    for (const l of empty)
      root = root ? removeLeaf(root, l.id) : null
    if (!root || root === ws.root)
      return
    const next = root
    const leaves = leafList(next)
    const focusId = leaves.some(l => l.id === ws.focusId) ? ws.focusId : leaves[0].id
    runPaneMorph(empty.map(l => l.id), () =>
      set({
        workspaces: mapActive(s, w => ({ ...w, root: next, focusId })),
        ...clearedSelection,
      }))
  },

  openStickerMaker: paneId => set({ stickerMakerFor: paneId }),

  closePane: (paneId) => {
    const s = get()
    const ws = activeWs(s)
    const next = removeLeaf(ws.root, paneId)
    if (!next || next === ws.root)
      return
    const leaves = leafList(next)
    const focusId = leaves.some(l => l.id === ws.focusId) ? ws.focusId : leaves[0].id
    runPaneMorph([paneId], () =>
      set({
        workspaces: mapActive(s, w => ({
          ...w,
          root: next,
          focusId,
        })),
      }))
  },

  deletePane: (paneId) => {
    const s = get()
    const ws = activeWs(s)
    const next = deletePane(ws.root, paneId)
    if (next === ws.root)
      return
    const leaves = leafList(next)
    const focusId = leaves.some(l => l.id === ws.focusId) ? ws.focusId : leaves[0].id
    runPaneMorph([paneId], () =>
      set({
        workspaces: mapActive(s, w => ({ ...w, root: next, focusId })),
        ...clearedSelection,
      }))
  },

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
    })),

  swapPhotos: (a, b) =>
    set((s) => {
      const ws = activeWs(s)
      const root = swapLeafContents(ws.root, a, b)
      return root === ws.root ? {} : { workspaces: mapActive(s, w => ({ ...w, root })) }
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

  /**
   * Place a batch of photos into the active workspace's empty panes, in layout
   * order (leafList), pairing them with the ids in selection order. Photos past
   * the last empty pane are dropped; the focus follows the last pane filled.
   */
  assignMany: photoIds =>
    set((s) => {
      if (!photoIds.length)
        return {}
      const ws = activeWs(s)
      let next = ws.root
      let focusId = ws.focusId
      let k = 0
      for (const leaf of leafList(ws.root)) {
        if (leaf.photoId || k >= photoIds.length)
          continue
        next = updateLeafIn(next, leaf.id, {
          photoId: photoIds[k++],
          zoom: 1,
          cx: 0.5,
          cy: 0.5,
          stickers: [],
        })
        focusId = leaf.id
      }
      if (next === ws.root)
        return {}
      return { workspaces: mapActive(s, w => (w.id === ws.id ? { ...w, root: next, focusId } : w)) }
    }),

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

  selectLabel: labelId => set({ labelSel: labelId, stickerSel: null }),
  selectSticker: sel => set({ stickerSel: sel, labelSel: null }),
  requestLabelEdit: labelId => set({ labelEditReq: { labelId, seq: ++labelEditSeq } }),
  setToolsDockMode: mode => set({ toolsDockMode: mode }),

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
      blendCrossfade: BLEND_CROSSFADE,
      paneBorder: PANE_BORDER,
      dockBg: DOCK_BG,
      dockOpacity: DOCK_OPACITY,
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
      if (from === -1 || to < 0 || to >= Math.min(s.workspaces.length, MAX_WORKSPACES) || from === to)
        return {}
      const next = [...s.workspaces]
      const [ws] = next.splice(from, 1)
      next.splice(to, 0, ws)
      return { workspaces: next }
    }),

  addSticker: (photoId, x = 0.5, y = 0.5) =>
    set((s) => {
      const st: Sticker = { id: uid('t'), photoId, x, y, s: 0.2, rot: 0 }
      return {
        workspaces: mapActive(s, w => ({
          ...w,
          stickers: [...(w.stickers ?? []), st],
        })),
      }
    }),

  moveSticker: (stickerId, x, y) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).map(st => (st.id === stickerId ? { ...st, x, y } : st)),
      })),
    })),

  scaleSticker: (stickerId, sVal) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).map(st => (st.id === stickerId
          ? { ...st, s: Math.min(1.5, Math.max(0.02, sVal)) }
          : st)),
      })),
    })),

  rotateSticker: (stickerId, rot) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).map(st => (st.id === stickerId
          ? { ...st, rot: wrapAngle(rot) }
          : st)),
      })),
    })),

  removeSticker: stickerId =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).filter(t => t.id !== stickerId),
      })),
      stickerSel: s.stickerSel?.stickerId === stickerId ? null : s.stickerSel,
    })),

  addLabel: (x = 0.5, y = 0.5) => {
    const label = newLabel(x, y)
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, labels: [...(w.labels ?? []), label] })),
      labelSel: label.id,
      stickerSel: null,
    }))
    return label.id
  },

  setLabel: (labelId, patch) =>
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        labels: (w.labels ?? []).map((l) => {
          if (l.id !== labelId)
            return l
          const label: PaneLabel = { ...l, ...patch, id: l.id }
          if (patch.size !== undefined)
            label.size = Math.min(160, Math.max(12, patch.size))
          if (patch.rot !== undefined)
            label.rot = wrapAngle(patch.rot)
          return label
        }),
      })),
    })),

  removeLabel: labelId =>
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, labels: (w.labels ?? []).filter(l => l.id !== labelId) })),
      labelSel: s.labelSel === labelId ? null : s.labelSel,
    })),
}), {
  // Visual settings survive reloads; the rest of the state (workspaces,
  // photos) stays session-only.
  name: 'collage:settings',
  // v1: crossfade became the default blend. v0 always persisted
  // `blendCrossfade: false` (the old default) even if never touched, so it
  // cannot be told apart from an explicit choice: reset it to the new default.
  version: SETTINGS_VERSION,
  // v2: dock background/opacity + persisted dock mode. v3: drop dockHandleIcon. v4: drop 'transparent' dock style. v5: solid default. v6: gridCellRatio.
  migrate: migrateSettings,
  partialize: state => ({
    gap: state.gap,
    gridGap: state.gridGap,
    radius: state.radius,
    bg: state.bg,
    edgeFade: state.edgeFade,
    edgeFadeStrength: state.edgeFadeStrength,
    blendCrossfade: state.blendCrossfade,
    paneBorder: state.paneBorder,
    dockBg: state.dockBg,
    gridCellRatio: state.gridCellRatio,
    dockOpacity: state.dockOpacity,
    toolsDockMode: state.toolsDockMode,
  }),
}))

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
  /** Returns the new workspace's id, or null when the board is full. */
  addWorkspace: () => string | null
  removeWorkspace: (id: string) => void
  shuffleWorkspaces: (rng?: () => number) => void
  clearGridPhotos: () => void
  resetAllWorkspaces: () => void
  hydrate: (session: { meta: SessionMeta, photos: Photo[] }) => void
  split: (paneId: string, dir: 'row' | 'column') => void
  closePane: (paneId: string) => void
  deletePane: (paneId: string) => void
  resizeSplit: (splitId: string, ratio: number) => void
  assign: (paneId: string, photoId: string) => void
  assignMany: (photoIds: string[]) => void
  removePhoto: (paneId: string) => void
  /** Swap two panes' contents: photo, view, stickers and label. */
  swapPhotos: (a: string, b: string) => void
  updateLeaf: (paneId: string, patch: Partial<Leaf>) => void
  focus: (paneId: string) => void
  focusNeighbor: (dir: FocusDir) => void
  selectLabel: (labelId: string | null) => void
  selectSticker: (sel: { stickerId: string } | null) => void
  requestLabelEdit: (labelId: string) => void
  setToolsDockMode: (mode: ToolsDockMode) => void
  autoFill: () => void
  patch: (p: Partial<State>) => void
  resetSettings: () => void
  setCanvasSize: (ratio: number, fill: number) => void
  clearSelection: () => void
  moveWorkspace: (id: string, to: number) => void
  addSticker: (photoId: string, x?: number, y?: number) => void
  moveSticker: (stickerId: string, x: number, y: number) => void
  scaleSticker: (stickerId: string, s: number) => void
  rotateSticker: (stickerId: string, rot: number) => void
  removeSticker: (stickerId: string) => void
  /** Add a board label at a canvas-normalized point; returns its id. */
  addLabel: (x?: number, y?: number) => string
  setLabel: (labelId: string, patch: Partial<PaneLabel>) => void
  removeLabel: (labelId: string) => void
}
