import type { BgImage } from './lib/collageBg'
import type { CutoutMap } from './lib/cutout'
import type { GridCellRatio } from './lib/gridTools'
import type { History } from './lib/history'
import type { Photo } from './lib/imageStore'
import type { Divider, FocusDir, Leaf, Node, PaneLabel, Sticker } from './lib/panes'
import type { SessionMeta } from './lib/sessionStore'
import type { GridGroup, ParkedBoard } from './lib/workspaces'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearTreePhotos, GRID_CELL_RATIO, isGridCellRatio, shuffleFilled } from './lib/gridTools'
import { looksHeic, probeHeic, warmHeicDecoder } from './lib/heic'
import { emptyHistory, record, redoStep, undoStep } from './lib/history'
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
import { activeAfterRemove, addGroup, addSlot, DEFAULT_WORKSPACES, MAX_GRIDS, MAX_WORKSPACES, nextGridName, normalizeGrids, normalizeSlots, removeGroup, removeSlot, renameGroup, resetSlot } from './lib/workspaces'

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
  /** The open group's nine cells (every board action works on these). */
  workspaces: Workspace[]
  activeId: string
  /**
   * The board groups, in bar order (see `lib/workspaces`): two of them can be
   * compared side by side. The open group's cells are `workspaces`; the other
   * groups' boards sit in `parkedBoards`, so nothing but the group actions has
   * to know groups exist.
   */
  grids: GridGroup[]
  /** The group the grid overview and the editor work on. */
  activeGridId: string
  /** Boards of the groups that are not open, by group id. */
  parkedBoards: Record<string, ParkedBoard<Workspace>>
  /** The workspace the G key / center button returns to (tracked by id, not position). */
  gap: number
  /** Space between the nine overview cells, in px (grid view only). */
  gridGap: number
  radius: number
  bg: string
  /** Whole-collage background gradient end color over `bg` (see lib/collageBg). */
  bgGradient: string | null
  /** Whole-collage background photo over `bg` (see lib/collageBg). */
  bgImage: BgImage | null
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
  /** Cut-out photo id → the photo it was cut from (see lib/cutout); saved with the session. */
  cutouts: CutoutMap
  /** The one running pane cutout, for the pane's progress overlay. Session-only. */
  cutoutJob: { paneId: string, phase: 'loading' | 'processing', progress?: number } | null
  /**
   * Undo / redo over the workspace board (see `lib/history`), app-global and
   * session-only: never persisted, and a reload forgets it.
   */
  history: History<UndoSnapshot>
}

/**
 * The slices undo / redo restores. Deliberately not the photo library (undo
 * never imports or destroys a photo, so a pane it restores always still has
 * its source), nor the selection, the dock or any other visual setting: those
 * are not board mutations, and snapshotting them would let one undo reach back
 * past an unrelated settings change.
 */
export interface UndoSnapshot {
  workspaces: Workspace[]
  activeId: string
  grids: GridGroup[]
  activeGridId: string
  parkedBoards: Record<string, ParkedBoard<Workspace>>
  bg: string
  bgGradient: string | null
  bgImage: BgImage | null
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
export const TOOLS_DOCK_MODE: ToolsDockMode = 'row'

export const SETTINGS_VERSION = 8

const DOCK_BGS: readonly DockBg[] = ['solid', 'frosted', 'liquid']
const DOCK_MODES: readonly ToolsDockMode[] = ['collapsed', 'row', 'expanded']

/** Persisted-settings migration (zustand `persist`); pure for unit tests. */
export function migrateSettings(persisted: unknown, version: number): Record<string, unknown> {
  const p = { ...(persisted as Record<string, unknown> | null ?? {}) }
  if (version < 1)
    p.blendCrossfade = BLEND_CROSSFADE
  // v2: dock background + opacity + handle icon, and the dock mode is now
  // persisted (see v6 for the default). Sanitize either way.
  if (version < 2)
    p.toolsDockMode = TOOLS_DOCK_MODE
  // v6: the default dock mode became 'row'. A saved pre-v6 'collapsed' was
  // the old default and can't be told from a choice, so reset it once.
  if (version < 6)
    p.toolsDockMode = TOOLS_DOCK_MODE
  // v5: default became solid. Pre-v5 'frosted' was the old default and can't
  // be told from an explicit pick (preview-only), so reset it.
  if (version < 5 && p.dockBg === 'frosted')
    p.dockBg = DOCK_BG
  // v7: grid cell aspect ratio (1:1 default).
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
  // v8: whole-collage background layers over the gap fill; off for old saves.
  if (version < 8) {
    p.bgGradient ??= null
    p.bgImage ??= null
  }
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
/** The one group a fresh board starts with: group 1. */
const bootGridId = uid('g')

/** Active workspace (never null: activeId always matches a workspace). */
export function activeWs(s: State): Workspace {
  return s.workspaces.find(w => w.id === s.activeId) ?? s.workspaces[0]
}

/** A stable empty board: a selector must not hand back a fresh array. */
const NO_BOARD: Workspace[] = []

/**
 * A group's board, open or parked. The compare view reads both sides through
 * this, so it never has to know which one the editor is pointed at.
 */
export function boardOf(s: State, gridId: string): Workspace[] {
  return gridId === s.activeGridId ? s.workspaces : s.parkedBoards[gridId]?.workspaces ?? NO_BOARD
}

/** Map over the active workspace, keeping the array order. */
function mapActive(s: State, fn: (w: Workspace) => Workspace): Workspace[] {
  return s.workspaces.map(w => (w.id === s.activeId ? fn(w) : w))
}

/** The undoable slices of `s` as one shallow snapshot (see UndoSnapshot). */
function snapshotOf(s: State): UndoSnapshot {
  return {
    workspaces: s.workspaces,
    activeId: s.activeId,
    grids: s.grids,
    activeGridId: s.activeGridId,
    parkedBoards: s.parkedBoards,
    bg: s.bg,
    bgGradient: s.bgGradient,
    bgImage: s.bgImage,
  }
}

/**
 * A snapshot's slices as a state patch. The active workspace only moves when
 * the snapshot no longer holds it (undo of a workspace add / remove, or of a
 * reset that kept the slot): undoing a pane action must never yank the view to
 * another slot. The same holds for the open group: undoing a group add or
 * delete re-parks the board it removed, so the two always travel together.
 */
function restoreSnapshot(s: State, snap: UndoSnapshot): Partial<State> {
  const keep = snap.workspaces.some(w => w.id === s.activeId)
    ? s.activeId
    : snap.workspaces.some(w => w.id === snap.activeId) ? snap.activeId : snap.workspaces[0].id
  return {
    workspaces: snap.workspaces,
    activeId: keep,
    grids: snap.grids,
    activeGridId: snap.activeGridId,
    parkedBoards: snap.parkedBoards,
    bg: snap.bg,
    bgGradient: snap.bgGradient,
    bgImage: snap.bgImage,
  }
}

/**
 * The state keys a generic `patch()` may carry that are part of a snapshot:
 * a patch touching one of them is a board / background mutation and commits
 * like any other action, while the rest (gap, radius, dims, cutout jobs, …)
 * stays outside the history.
 */
const UNDOABLE_PATCH_KEYS = ['workspaces', 'bg', 'bgGradient', 'bgImage'] as const

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
  cutouts: {},
  cutoutJob: null,
  workspaces: bootWorkspaces,
  activeId: bootWorkspaces[0].id,
  grids: [{ id: bootGridId, name: '1' }],
  activeGridId: bootGridId,
  parkedBoards: {},
  gap: GAP,
  gridGap: GRID_GAP,
  radius: RADIUS,
  bg: BG,
  bgGradient: null,
  bgImage: null,
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
  history: emptyHistory(),

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

    // The library itself is not undoable (an undo never drops imported files:
    // the snapshot leaves `photos` alone), but the auto-fill it triggers is,
    // through `autoFill`'s own commit.
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
      // grid slot: `activeId` and `mapActive` key off those ids, so new ones
      // would leave every later pane action pointed at nothing. Every group is
      // wiped, not just the open one: the photos are gone everywhere.
      workspaces: s.workspaces.map(w => ({ ...newWorkspace(), id: w.id })),
      parkedBoards: Object.fromEntries(Object.entries(s.parkedBoards).map(([id, b]) => [
        id,
        { ...b, workspaces: b.workspaces.map(w => ({ ...newWorkspace(), id: w.id })) },
      ])),
      labelSel: null,
      stickerSel: null,
      labelEditReq: null,
      // The clipboard points at photos that no longer exist.
      paneClip: null,
      stickerMakerFor: null,
      cutouts: {},
      // The background photo is gone with the library.
      bgImage: null,
      // The photos it wiped cannot come back: the saved session and the image
      // caches are gone with them, so no snapshot can restore this state.
      history: emptyHistory(),
    }))
  },

  /**
   * Reset one workspace to a fresh blank canvas, keeping its id and grid
   * slot (the photos fall back to the library; everything else is untouched).
   */
  resetWorkspace: (id) => {
    if (!get().workspaces.some(w => w.id === id))
      return
    commit()
    set(s => ({
      workspaces: resetSlot(s.workspaces, id, newWorkspace),
      ...clearedSelection,
    }))
  },

  /** Append a blank workspace (the grid's + cell); no-op at nine. */
  addWorkspace: () => {
    const before = get().workspaces
    const next = addSlot(before, newWorkspace)
    if (next === before)
      return null
    commit()
    set({ workspaces: next })
    return next[next.length - 1].id
  },

  /**
   * Remove a workspace from the grid (drag-to-delete); the others close up.
   * The last one is reset in place instead, so there is always a workspace.
   */
  removeWorkspace: (id) => {
    const s = get()
    const next = removeSlot(s.workspaces, id, newWorkspace)
    if (next === s.workspaces)
      return
    commit()
    set({ workspaces: next, activeId: activeAfterRemove(s.workspaces, next, s.activeId), ...clearedSelection })
  },

  // ---- grid groups (dual 9-grid: two boards side by side) ------------------

  /**
   * Add a board group and open it (the group bar's +): the open board parks and
   * a fresh nine takes its place. Null at the cap.
   */
  addGrid: (name) => {
    const s = get()
    if (s.grids.length >= MAX_GRIDS)
      return null
    const group: GridGroup = { id: uid('g'), name: name?.trim() || nextGridName(s.grids) }
    const next = addGroup(s.grids, () => group)
    if (next === s.grids)
      return null
    const workspaces = initialWorkspaces()
    commit()
    set({
      grids: next,
      activeGridId: group.id,
      workspaces,
      activeId: workspaces[0].id,
      parkedBoards: { ...s.parkedBoards, [s.activeGridId]: { workspaces: s.workspaces, activeId: s.activeId } },
      ...clearedSelection,
    })
    return group.id
  },

  /**
   * Delete a group and its board; the last group stays. Deleting the open one
   * opens its left-hand neighbour (else its right), so the editor is never left
   * pointing at a board that no longer exists.
   */
  removeGrid: (id) => {
    const s = get()
    const next = removeGroup(s.grids, id)
    if (next === s.grids)
      return
    const parkedBoards = { ...s.parkedBoards }
    let { workspaces, activeId, activeGridId } = s
    if (id === s.activeGridId) {
      const left = next[Math.max(0, s.grids.findIndex(g => g.id === id) - 1)]
      const parked = parkedBoards[left.id] ?? { workspaces: initialWorkspaces(), activeId: '' }
      delete parkedBoards[left.id]
      workspaces = parked.workspaces
      activeId = workspaces.some(w => w.id === parked.activeId) ? parked.activeId : workspaces[0].id
      activeGridId = left.id
    }
    else {
      delete parkedBoards[id]
    }
    commit()
    set({ grids: next, parkedBoards, activeGridId, workspaces, activeId, ...clearedSelection })
  },

  /** Rename a group (undoable, like any other change to the board). */
  renameGrid: (id, name) => {
    const next = renameGroup(get().grids, id, name)
    if (next === get().grids)
      return
    commit()
    set({ grids: next })
  },

  /**
   * Open another group's board. Navigation, not a board mutation (like
   * `patch({ activeId })`): it pushes no undo entry, and the group it leaves
   * keeps its cells and the cell it was last on.
   */
  switchGrid: (id) => {
    const s = get()
    const target = id === s.activeGridId ? null : s.parkedBoards[id]
    if (!target)
      return
    const parkedBoards = { ...s.parkedBoards }
    delete parkedBoards[id]
    parkedBoards[s.activeGridId] = { workspaces: s.workspaces, activeId: s.activeId }
    set({
      activeGridId: id,
      parkedBoards,
      workspaces: target.workspaces,
      activeId: target.workspaces.some(w => w.id === target.activeId) ? target.activeId : target.workspaces[0].id,
      ...clearedSelection,
    })
  },

  /**
   * Reset every workspace to a fresh blank canvas, keeping their ids and
   * grid slots (photos fall back to the library; the board itself stays).
   */
  /** Grid Shuffle: randomly reorder the workspaces that hold photos; empty slots stay. */
  shuffleWorkspaces: (rng?: () => number) => {
    const workspaces = get().workspaces
    // Fewer than two filled cells has nothing to shuffle: no undo entry either.
    if (workspaces.filter(w => leafList(w.root).some(l => l.photoId)).length < 2)
      return
    commit()
    set({ workspaces: shuffleFilled(workspaces, w => leafList(w.root).some(l => l.photoId), rng) })
  },

  /** Grid Clear: drop every photo (panes and board stickers) from all workspaces; layouts stay. */
  clearGridPhotos: () => {
    const s = get()
    const any = s.workspaces.some(w => (w.stickers?.length ?? 0) > 0 || leafList(w.root).some(l => l.photoId))
    if (!any)
      return
    commit()
    set(st => ({
      workspaces: st.workspaces.map(w => ({ ...w, root: clearTreePhotos(w.root), stickers: [] })),
      ...clearedSelection,
    }))
  },

  resetAllWorkspaces: () => {
    commit()
    set(s => ({
      workspaces: s.workspaces.map(w => ({ ...newWorkspace(), id: w.id })),
      ...clearedSelection,
    }))
  },

  /** Restore a session saved by `lib/sessionStore` (refresh-safe autosave). */
  hydrate: (session) => {
    // Each group's board is brought within 1–9 cells (see normalizeSlots), and
    // a session saved before groups becomes one group holding the board it
    // saved (see normalizeGrids). Legacy pane stickers / labels land on the
    // board on the way in, as they always have.
    const hydrated = normalizeGrids<Workspace>(
      {
        grids: session.meta.grids,
        workspaces: session.meta.workspaces,
        activeGridId: session.meta.activeGridId,
        activeId: session.meta.activeId,
      },
      newWorkspace,
      () => uid('g'),
    )
    const lift = (list: Workspace[]) => list.map(w => migrateWorkspaceInserts(w, session.photos))
    const parkedBoards: Record<string, ParkedBoard<Workspace>> = {}
    for (const [id, board] of Object.entries(hydrated.parked))
      parkedBoards[id] = { workspaces: lift(board.workspaces), activeId: board.activeId }
    set({
      ...session.meta,
      grids: hydrated.grids,
      activeGridId: hydrated.activeGridId,
      parkedBoards,
      workspaces: lift(hydrated.workspaces),
      activeId: hydrated.activeId,
      photos: session.photos,
      // Sessions saved before one-tap cutout have no map.
      cutouts: session.meta.cutouts ?? {},
      cutoutJob: null,
      labelSel: null,
      stickerSel: null,
      labelEditReq: null,
      paneClip: null,
      stickerMakerFor: null,
      // A restored session is a new starting point, not an edit of the old one.
      history: emptyHistory(),
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
    commit()
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
    commit()
    runPaneMorph([], () =>
      set({ workspaces: mapActive(s, w => ({ ...w, root, focusId: created.id })) }))
  },

  /** Empty one pane back to a blank half of the canvas (label and stickers included). */
  resetPane: (paneId) => {
    if (!findLeaf(activeWs(get()).root, paneId))
      return
    commit()
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
    }))
  },

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

  pastePane: (paneId) => {
    const s = get()
    const clip = s.paneClip
    if (!clip || !findLeaf(activeWs(s).root, paneId))
      return
    commit()
    set(st => ({
      workspaces: mapActive(st, w => ({
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
    }))
  },

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
    commit()
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
    commit()
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
    commit()
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
    commit()
    runPaneMorph([paneId], () =>
      set({
        workspaces: mapActive(s, w => ({ ...w, root: next, focusId })),
        ...clearedSelection,
      }))
  },

  /** Dragging a divider streams ratios: one gesture is one undo step. */
  resizeSplit: (splitId, ratio) => {
    commit(`resizeSplit:${splitId}`)
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, root: setSplitRatioIn(w.root, splitId, ratio) })),
    }))
  },

  removePhoto: (paneId) => {
    if (!findLeaf(activeWs(get()).root, paneId))
      return
    commit()
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        root: updateLeafIn(w.root, paneId, { photoId: null, zoom: 1, cx: 0.5, cy: 0.5, stickers: [] }),
      })),
    }))
  },

  swapPhotos: (a, b) => {
    const s = get()
    const ws = activeWs(s)
    const root = swapLeafContents(ws.root, a, b)
    if (root === ws.root)
      return
    commit()
    set(st => ({ workspaces: mapActive(st, w => ({ ...w, root })) }))
  },

  assign: (paneId, photoId) => {
    if (!findLeaf(activeWs(get()).root, paneId))
      return
    commit()
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
    }))
  },

  /**
   * Place a batch of photos into the active workspace's empty panes, in layout
   * order (leafList), pairing them with the ids in selection order. Photos past
   * the last empty pane are dropped; the focus follows the last pane filled.
   */
  assignMany: (photoIds) => {
    const s = get()
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
      return
    commit()
    set(st => ({ workspaces: mapActive(st, w => (w.id === ws.id ? { ...w, root: next, focusId } : w)) }))
  },

  /** Panning and zooming a pane streams patches: one gesture is one undo step. */
  updateLeaf: (paneId, patch) => {
    commit(`updateLeaf:${paneId}`)
    set(s => ({ workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, patch) })) }))
  },

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

  autoFill: () => {
    const s = get()
    if (!s.photos.length)
      return
    let k = 0
    const ws = activeWs(s)
    let next = ws.root
    for (const leaf of leafList(ws.root)) {
      if (leaf.photoId)
        continue
      const p = s.photos[k++ % s.photos.length]
      next = updateLeafIn(next, leaf.id, { photoId: p.id, zoom: 1, cx: 0.5, cy: 0.5 })
    }
    if (next === ws.root)
      return
    commit()
    set(st => ({ workspaces: mapActive(st, w => (w.id === ws.id ? { ...w, root: next } : w)) }))
  },

  /**
   * A generic patch. Only the keys a snapshot carries (the board and its
   * background) make it an undoable mutation; navigation (`activeId`), the
   * dock, cutout jobs and the visual settings stay out of the history. The tag
   * keeps a colour picked by dragging the swatch a single undo step.
   */
  patch: (p) => {
    const undoable = Object.keys(p).filter(k => (UNDOABLE_PATCH_KEYS as readonly string[]).includes(k))
    if (undoable.length)
      commit(`patch:${undoable.sort().join(',')}`)
    set(p)
  },

  // The settings drawer's Reset: every visual knob back to its default. The
  // font mirror is not in the store (it lives in lib/fonts), so the drawer
  // resets that one itself.
  resetSettings: () =>
    set({
      gap: GAP,
      gridGap: GRID_GAP,
      radius: RADIUS,
      bg: BG,
      bgGradient: null,
      bgImage: null,
      edgeFade: EDGE_FADE,
      edgeFadeStrength: EDGE_FADE_STRENGTH,
      blendCrossfade: BLEND_CROSSFADE,
      paneBorder: PANE_BORDER,
      dockBg: DOCK_BG,
      dockOpacity: DOCK_OPACITY,
    }),

  /** Dragging the canvas handle streams sizes: one gesture is one undo step. */
  setCanvasSize: (ratio, fill) => {
    commit('setCanvasSize')
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        canvasRatio: Math.min(8, Math.max(0.12, ratio)),
        canvasFill: Math.min(1, Math.max(0.15, fill)),
      })),
    }))
  },

  /** Clear selection-type state on any workspace / view switch. */
  clearSelection: () => set({ ...clearedSelection }),

  /** Insert-shift reorder: remove `id` from its slot and splice it at `to`. */
  moveWorkspace: (id, to) => {
    const s = get()
    const from = s.workspaces.findIndex(w => w.id === id)
    if (from === -1 || to < 0 || to >= Math.min(s.workspaces.length, MAX_WORKSPACES) || from === to)
      return
    const next = [...s.workspaces]
    const [ws] = next.splice(from, 1)
    next.splice(to, 0, ws)
    commit()
    set({ workspaces: next })
  },

  addSticker: (photoId, x = 0.5, y = 0.5) => {
    commit()
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: [...(w.stickers ?? []), { id: uid('t'), photoId, x, y, s: 0.2, rot: 0 } satisfies Sticker],
      })),
    }))
  },

  /** Dragging a sticker streams positions: one gesture is one undo step. */
  moveSticker: (stickerId, x, y) => {
    commit(`moveSticker:${stickerId}`)
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).map(st => (st.id === stickerId ? { ...st, x, y } : st)),
      })),
    }))
  },

  /** The scale handle streams sizes: one gesture is one undo step. */
  scaleSticker: (stickerId, sVal) => {
    commit(`scaleSticker:${stickerId}`)
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).map(st => (st.id === stickerId
          ? { ...st, s: Math.min(1.5, Math.max(0.02, sVal)) }
          : st)),
      })),
    }))
  },

  /** The rotation handle and its slider stream angles: one gesture is one undo step. */
  rotateSticker: (stickerId, rot) => {
    commit(`rotateSticker:${stickerId}`)
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).map(st => (st.id === stickerId
          ? { ...st, rot: wrapAngle(rot) }
          : st)),
      })),
    }))
  },

  removeSticker: (stickerId) => {
    if (!get().workspaces.some(w => (w.stickers ?? []).some(st => st.id === stickerId)))
      return
    commit()
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).filter(t => t.id !== stickerId),
      })),
      stickerSel: s.stickerSel?.stickerId === stickerId ? null : s.stickerSel,
    }))
  },

  addLabel: (x = 0.5, y = 0.5) => {
    const label = newLabel(x, y)
    commit()
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, labels: [...(w.labels ?? []), label] })),
      labelSel: label.id,
      stickerSel: null,
    }))
    return label.id
  },

  /** Dragging a label (or typing into it) streams patches: one gesture is one undo step. */
  setLabel: (labelId, patch) => {
    commit(`setLabel:${labelId}`)
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
    }))
  },

  removeLabel: (labelId) => {
    if (!get().workspaces.some(w => (w.labels ?? []).some(l => l.id === labelId)))
      return
    commit()
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, labels: (w.labels ?? []).filter(l => l.id !== labelId) })),
      labelSel: s.labelSel === labelId ? null : s.labelSel,
    }))
  },

  /** Step back one board mutation (session-only; see lib/history). */
  undo: () =>
    set((s) => {
      const step = undoStep(s.history, snapshotOf(s))
      if (!step)
        return {}
      return { ...restoreSnapshot(s, step.snapshot), history: step.history }
    }),

  /** Step forward again after an undo; cleared by the next new action. */
  redo: () =>
    set((s) => {
      const step = redoStep(s.history, snapshotOf(s))
      if (!step)
        return {}
      return { ...restoreSnapshot(s, step.snapshot), history: step.history }
    }),

  /** Forget the stacks: a replaced board (session hydrate, opened file) starts clean. */
  resetHistory: () => set({ history: emptyHistory() }),
}), {
  // Visual settings survive reloads; the rest of the state (workspaces,
  // photos) stays session-only.
  name: 'collage:settings',
  // v1: crossfade became the default blend. v0 always persisted
  // `blendCrossfade: false` (the old default) even if never touched, so it
  // cannot be told apart from an explicit choice: reset it to the new default.
  version: SETTINGS_VERSION,
  // v2: dock background/opacity + persisted dock mode. v3: drop dockHandleIcon. v4: drop 'transparent' dock style. v5: solid default. v6: dock mode reset to row. v7: gridCellRatio.
  migrate: migrateSettings,
  partialize: state => ({
    gap: state.gap,
    gridGap: state.gridGap,
    radius: state.radius,
    bg: state.bg,
    bgGradient: state.bgGradient,
    bgImage: state.bgImage,
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

/**
 * Capture the undoable slices before an action mutates them. Every mutating
 * action calls this *after* its own no-op guard, so an action that changes
 * nothing never pushes an entry. `tag` collapses a gesture's stream of
 * mutations into the single step undo returns to (see lib/history).
 */
function commit(tag: string | null = null): void {
  useStore.setState(s => ({ history: record(s.history, snapshotOf(s), Date.now(), tag) }))
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
  /** Returns the new group's id, or null at the group cap. */
  addGrid: (name?: string) => string | null
  removeGrid: (id: string) => void
  renameGrid: (id: string, name: string) => void
  /** Open a group's board (navigation: pushes no undo entry). */
  switchGrid: (id: string) => void
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
  /** Step back / forward over the board's mutations (see lib/history). */
  undo: () => void
  redo: () => void
  /** Drop both stacks: a replaced board has nothing earlier to return to. */
  resetHistory: () => void
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
