import type { CardKind } from './lib/cards'
import type { CutoutMap } from './lib/cutout'
import type { CutoutSets } from './lib/cutoutVariants'
import type { FilterValue } from './lib/filters'
import type { History } from './lib/history'
import type { Photo } from './lib/imageStore'
import type { MusicMeta } from './lib/musicLink'
import type { FocusDir, Leaf, Node, PaneLabel, Sticker } from './lib/panes'
import type { PhotoKind } from './lib/photoLibrary'
import type { SessionMeta } from './lib/sessionStore'
import type { PersistedSettings, ToolsDockMode } from './lib/settingsStore'
import type { StickerRecipe } from './lib/stickerRecipe'
import type { GridGroup, ParkedBoard } from './lib/workspaces'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { cardWorkspace } from './lib/cards'
import { dropCutoutSetRefs, normalizeCutoutSets, pruneCutoutSets } from './lib/cutoutVariants'
import { readExif } from './lib/exif'
import { clearFilterCaches } from './lib/filterCache'
import { sameFilter } from './lib/filters'
import {
  clearTreePhotos,
  GRID_CELL_RATIO,
  shuffleFilled,
} from './lib/gridTools'
import { emptyHistory, jump, record, stepDown, stepUp } from './lib/history'
import { clearImageCaches } from './lib/imageStore'
import { computeLayout, migrateWorkspaceInserts } from './lib/layout'
import { CARD_SIZE as MUSIC_CARD_SIZE } from './lib/musicCard'
import {
  cloneNode,
  deletePane,
  findLeaf,
  layoutTree,
  leafList,
  neighborLeaf,

  newLabel,
  newLeaf,
  normalizeLabelGlow,

  removeLeaf,
  rotationOf,
  setSplitRatioIn,
  splitLeaf,
  swapLeafContents,

  uid,
  updateLeafIn,
  wrapAngle,
} from './lib/panes'
import { blankAllBoards, glueMotionFiles, importPhotoBatch, probePhotoDims, withPhotoDims } from './lib/photoLibrary'
import { addTag, deleteTag, normalizeTagList, renameTag, resolveTag, retag, untagAll, withoutTag, withTag } from './lib/photoTags'
import { clearSession } from './lib/sessionStore'
import { migrateSettings, partializeSettings, SETTINGS_DEFAULTS, SETTINGS_VERSION, TOOLS_DOCK_MODE } from './lib/settingsStore'
import {
  addFolder,
  deleteFolder,
  dropCutoutRefs,
  folderOf,
  gcRetired,
  normalizePhotoKinds,
  paneAssetsOf,
  pruneCutouts,
  referenceCounts,
  renameFolder,
  retirePhoto,
  withFolder,
} from './lib/stickerLibrary'
import { normalizePhotoRecipes } from './lib/stickerRecipe'
import { runPaneMorph } from './lib/viewTransition'
import { activeAfterRemove, addGroup, addSlot, DEFAULT_WORKSPACES, MAX_GRIDS, MAX_WORKSPACES, nextGridName, normalizeGrids, normalizeSlots, removeGroup, removeSlot, renameGroup, resetSlot } from './lib/workspaces'

// The transparent-fill test describes the collage background, so it lives with
// it in lib/collageBg; re-exported so the app's call sites keep one import site.
export { isTransparentBg } from './lib/collageBg'
// The seams this file was split along are re-exported here, so every other
// module keeps importing the store (see lib/layout, lib/photoLibrary,
// lib/settingsStore).
export { cachedGeometry, cachedSeams, computeGeometry, computeLayout, emptyGeometryCache, emptySeamsCache, fitCanvas, migrateWorkspaceInserts, paneShape, withLiveLeaves } from './lib/layout'
export type { Derived, Geometry } from './lib/layout'
export { photoMap } from './lib/photoLibrary'
export {
  BG,
  BLEND_CROSSFADE,
  DOCK_BG,
  DOCK_OPACITY,
  EDGE_FADE,
  EDGE_FADE_STRENGTH,
  GAP,
  GRID_GAP,
  migrateSettings,
  PANE_BORDER,
  partializeSettings,
  RADIUS,
  SETTINGS_DEFAULTS,
  SETTINGS_VERSION,
  TOOLS_DOCK_MODE,
} from './lib/settingsStore'

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
  /** Framing that travels with the photo: its turn, its mirrors, its texture. */
  rot?: number
  flipX?: boolean
  flipY?: boolean
  filter?: FilterValue
  stickers: Sticker[]
  label: PaneLabel | null
}

/**
 * Everything the store holds. The visual settings the reload keeps are
 * `PersistedSettings` (see lib/settingsStore, which also migrates them); what
 * follows is the session-only rest.
 */
interface State extends PersistedSettings {
  photos: Photo[]
  /**
   * The sticker folders that exist, even while empty (one level deep, named by
   * hand; a sticker's own `folder` says which one it is in, absent = Unsorted).
   * Library-shaped, not board-shaped: folder edits are outside the undo stack.
   */
  stickerFolders: string[]
  /**
   * The photo tags that exist, even while they label nothing (many per photo;
   * a photo's own `tags` say which ones it wears). Library-shaped like
   * `stickerFolders`: tag edits are outside the undo stack.
   */
  photoTags: string[]
  /** The open group's nine cells (every board action works on these). */
  workspaces: Workspace[]
  activeId: string
  /**
   * The board groups, in switcher order (see `lib/workspaces`): the overview
   * holds a handful of arrangements, switched from the workspace switcher.
   * The open group's cells are `workspaces`; the other
   * groups' boards sit in `parkedBoards`, so nothing but the group actions has
   * to know groups exist.
   */
  grids: GridGroup[]
  /** The group the grid overview and the editor work on. */
  activeGridId: string
  /** Boards of the groups that are not open, by group id. */
  parkedBoards: Record<string, ParkedBoard<Workspace>>
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
  /**
   * The app-wide music card dialog. A store flag for the same reason: the
   * stage dock and the library header open the one dialog mounted by the root.
   */
  musicCardOpen: boolean
  /**
   * The pane the finished music card goes into. Null when the dialog was
   * opened from the library, where a card is only added to the library.
   */
  musicCardFor: string | null
  /** Cut-out photo id → the photo it was cut from (see lib/cutout); saved with the session. */
  cutouts: CutoutMap
  /** The one running pane cutout, for the pane's progress overlay. Session-only. */
  cutoutJob: { paneId: string, phase: 'loading' | 'processing', progress?: number } | null
  /**
   * Each cut's library variants, by SOURCE photo id (see `lib/cutoutVariants`):
   * the cutout PNG and, once asked for, the blurred composite. Saved with the
   * session and `.koma.json`, because the dock's Cut out menu switches between
   * them long after the model run.
   */
  cutoutSets: CutoutSets
  /**
   * Undo / redo over the workspace board as a tree of steps (see
   * `lib/history`): app-global and session-only, never persisted, and a reload
   * forgets it.
   */
  history: History<UndoSnapshot>
}

/**
 * The slices undo / redo restores, in one list: `UndoSnapshot` is this tuple's
 * shape and `UNDOABLE_PATCH_KEYS` is derived from it, so a slice added here
 * cannot be forgotten by the snapshot, the restore or the generic `patch()`
 * (the hand-maintained patch-key list had drifted: it missed the groups, so
 * `patch({ grids })` skipped its undo step).
 *
 * Deliberately not the photo library (undo never imports or destroys a photo,
 * so a pane it restores always still has its source), nor the selection, the
 * dock or any other visual setting: those are not board mutations, and
 * snapshotting them would let one undo reach back past an unrelated settings
 * change.
 */
const UNDO_SLICES = ['workspaces', 'activeId', 'grids', 'activeGridId', 'parkedBoards', 'bg', 'bgGradient', 'bgImage'] as const satisfies readonly (keyof State)[]

/** The board state one undo / redo step restores (see `UNDO_SLICES`). */
export type UndoSnapshot = Pick<State, (typeof UNDO_SLICES)[number]>

export const MIN_PANE_PX = 56
/** Canvas ratio bounds: the narrowest and widest a split can be shaped to. */
export const MIN_CANVAS_RATIO = 0.12
export const MAX_CANVAS_RATIO = 8
export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 8

export type { DockBg, PersistedSettings, ToolsDockMode } from './lib/settingsStore'

function newWorkspace(kind?: CardKind): Workspace {
  if (kind)
    return cardWorkspace(kind)
  const root = newLeaf()
  return { id: uid('w'), root, focusId: root.id, canvasRatio: null, canvasFill: 1, stickers: [], labels: [] }
}

/**
 * A deep copy of one workspace with a fresh id on everything the store
 * addresses (workspace, panes, board stickers, labels); photos are shared
 * through the library, so `photoId` copies as-is. Used when a new grid group
 * copies the open board.
 */
function cloneWorkspace(ws: Workspace): Workspace {
  const root = cloneNode(ws.root)
  return {
    ...ws,
    id: uid('w'),
    root,
    focusId: leafList(root)[0]!.id,
    stickers: (ws.stickers ?? []).map(st => ({ ...st, id: uid('s') })),
    labels: (ws.labels ?? []).map(lab => ({ ...lab, id: uid('l') })),
  }
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
 * A group's board, open or parked. The workspace switcher reads every card
 * through this, so it never has to know which one the editor is pointed at.
 */
export function boardOf(s: State, gridId: string): Workspace[] {
  return gridId === s.activeGridId ? s.workspaces : s.parkedBoards[gridId]?.workspaces ?? NO_BOARD
}

/** Map over the active workspace, keeping the array order. */
function mapActive(s: State, fn: (w: Workspace) => Workspace): Workspace[] {
  return s.workspaces.map(w => (w.id === s.activeId ? fn(w) : w))
}

/**
 * The undoable slices of `s` as one shallow snapshot (see UndoSnapshot): a
 * shallow copy of exactly `UNDO_SLICES`, so a slice added to that list is in
 * the snapshot without a second edit.
 */
function snapshotOf(s: State): UndoSnapshot {
  const snap: UndoSnapshot = {} as UndoSnapshot
  for (const key of UNDO_SLICES)
    Object.assign(snap, { [key]: s[key] })
  return snap
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
  return { ...snap, activeId: keep }
}

/**
 * The state keys a generic `patch()` may carry that are part of a snapshot:
 * a patch touching one of them is a board / background mutation and commits
 * like any other action, while the rest (gap, radius, dims, cutout jobs, …)
 * stays outside the history.
 *
 * Taken from `UNDO_SLICES` (never by hand) so the two cannot drift. The open
 * workspace and the open group are in the snapshot too, but they are
 * navigation: `patch({ activeId })` must not commit, or entering a cell would
 * push an undo step (see `enter` in WorkspaceGrid).
 */
const NAVIGATION_SLICES = ['activeId', 'activeGridId'] as const
const UNDOABLE_PATCH_KEYS = UNDO_SLICES.filter(k => !(NAVIGATION_SLICES as readonly string[]).includes(k))

/**
 * Every photo id the session still draws or could draw again: the boards of
 * every group, the collage background, the pane clipboard, and both history
 * stacks (an undo or redo restores panes that reference a sticker, so a
 * reachable snapshot counts as a reference too). A retired asset is kept while
 * it appears here and collected once it does not (see lib/stickerLibrary).
 */
function livePhotoRefs(s: State): Set<string> {
  const boards: Workspace[] = [...s.workspaces]
  const singles: (string | null | undefined)[] = [s.bgImage?.photoId, s.paneClip?.photoId]
  for (const board of Object.values(s.parkedBoards))
    boards.push(...board.workspaces)
  for (const node of Object.values(s.history.nodes)) {
    const snap = node.snapshot
    boards.push(...snap.workspaces)
    for (const board of Object.values(snap.parkedBoards))
      boards.push(...board.workspaces)
    singles.push(snap.bgImage?.photoId)
  }
  return new Set(referenceCounts(boards, singles).keys())
}

/**
 * Retire one library asset (see `retirePhoto`): the record leaves the library,
 * or stays as an orphaned snapshot when a board still draws it, so a placed
 * copy keeps rendering in the preview and the export. The two delete actions
 * differ only in which kind of asset they accept.
 */
function retireAsset(s: State, photoId: string): Pick<State, 'photos' | 'cutouts' | 'cutoutSets'> {
  const photos = retirePhoto(s.photos, photoId, livePhotoRefs(s))
  if (photos === s.photos)
    return { photos, cutouts: s.cutouts, cutoutSets: s.cutoutSets }
  return { photos, cutouts: dropCutoutRefs(s.cutouts, photoId), cutoutSets: dropCutoutSetRefs(s.cutoutSets, photoId) }
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
  stickerFolders: [],
  photoTags: [],
  cutouts: {},
  cutoutJob: null,
  cutoutSets: {},
  workspaces: bootWorkspaces,
  activeId: bootWorkspaces[0].id,
  grids: [{ id: bootGridId, name: '1' }],
  activeGridId: bootGridId,
  parkedBoards: {},
  ...SETTINGS_DEFAULTS,
  toolsDockMode: TOOLS_DOCK_MODE,
  gridCellRatio: GRID_CELL_RATIO,
  longSide: 2048,
  format: 'image/jpeg',
  quality: 0.92,
  labelSel: null,
  stickerSel: null,
  labelEditReq: null,
  paneClip: null,
  stickerMakerFor: null,
  musicCardOpen: false,
  musicCardFor: null,
  history: emptyHistory(),

  addPhotos: (files, autoFill = true, kind: PhotoKind = 'photo') => {
    const { added, videos } = importPhotoBatch(files, kind)
    if (!added.length && !videos.size)
      return []
    set(s => ({ photos: [...glueMotionFiles(s.photos, videos), ...added] }))

    // `forEach` would drop each probe's promise on the floor. The probes are
    // independent and nothing waits on them, so start one per photo and let the
    // loop finish; each patch lands on its own leaf when it does.
    const probeDims = async (p: Photo) => {
      const d = await probePhotoDims(p.file)
      if (!d)
        return
      set(s => ({
        photos: withPhotoDims(s.photos, p.id, d),
        // Auto-set the aspect ratio of the ACTIVE workspace only, and only
        // while it is still unset. A sticker never sets it: it is decoration,
        // not the photo the canvas is shaped to.
        workspaces: s.workspaces.map(w => (w.id === s.activeId && w.canvasRatio == null && kind === 'photo'
          ? { ...w, canvasRatio: d.w / d.h }
          : w)),
      }))
    }

    // EXIF is a second header read, run beside the dimension probe: GPS and
    // capture time land on the library entry without blocking the import.
    const probeExif = async (p: Photo) => {
      const exif = await readExif(p.file)
      if (!exif?.gps && !exif?.takenAt)
        return
      set(s => ({
        photos: s.photos.map(x => (x.id === p.id ? { ...x, gps: exif.gps, takenAt: exif.takenAt } : x)),
      }))
    }

    for (const p of added) {
      void probeDims(p)
      void probeExif(p)
    }

    // The library itself is not undoable (an undo never drops imported files:
    // the snapshot leaves `photos` alone), but the auto-fill it triggers is,
    // through `autoFill`'s own commit.
    if (autoFill && leafList(activeWs(get()).root).every(l => !l.photoId))
      get().autoFill()
    return added
  },

  clearLibrary: () => {
    clearImageCaches()
    clearFilterCaches()
    void clearSession()
    set(s => ({
      photos: [],
      // The folders only ever grouped the stickers that are gone with them,
      // and the tags only ever labelled the photos that are.
      stickerFolders: [],
      photoTags: [],
      // Every group is wiped, not just the open one: the photos are gone
      // everywhere (see `blankAllBoards`).
      ...blankAllBoards(s.workspaces, s.parkedBoards, newWorkspace),
      labelSel: null,
      stickerSel: null,
      labelEditReq: null,
      // The clipboard points at photos that no longer exist.
      paneClip: null,
      stickerMakerFor: null,
      cutouts: {},
      cutoutSets: {},
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
    commit('resetWorkspace')
    set(s => ({
      workspaces: resetSlot(s.workspaces, id, newWorkspace),
      ...clearedSelection,
    }))
  },

  /**
   * Append a blank workspace or a card preset (the grid's + cell); no-op at
   * nine. A preset is seeded before the commit, so one undo removes it whole.
   */
  addWorkspace: (kind) => {
    const before = get().workspaces
    const next = addSlot(before, () => newWorkspace(kind))
    if (next === before)
      return null
    commit('addWorkspace')
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
    commit('removeWorkspace')
    set({ workspaces: next, activeId: activeAfterRemove(s.workspaces, next, s.activeId), ...clearedSelection })
  },

  // ---- grid groups (boards switched from the workspace switcher) ----------

  /**
   * Add a board group and open it (the switcher's +): the new board is a deep
   * copy of the open group's board. Photos are shared through the library
   * (`photoId` copies as-is) while every pane, sticker and label gets a fresh
   * id (see `cloneNode`). The open board parks. Null at the cap.
   */
  addGrid: (name) => {
    const s = get()
    if (s.grids.length >= MAX_GRIDS)
      return null
    const group: GridGroup = { id: uid('g'), name: name?.trim() || nextGridName(s.grids) }
    const next = addGroup(s.grids, () => group)
    if (next === s.grids)
      return null
    const workspaces = s.workspaces.map(cloneWorkspace)
    commit('addGrid')
    set({
      grids: next,
      activeGridId: group.id,
      workspaces,
      activeId: workspaces[0]!.id,
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
    commit('removeGrid')
    set({ grids: next, parkedBoards, activeGridId, workspaces, activeId, ...clearedSelection })
  },

  /** Rename a group (undoable, like any other change to the board). */
  renameGrid: (id, name) => {
    const next = renameGroup(get().grids, id, name)
    if (next === get().grids)
      return
    commit('renameGrid')
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
    commit('shuffleWorkspaces')
    set({ workspaces: shuffleFilled(workspaces, w => leafList(w.root).some(l => l.photoId), rng) })
  },

  /** Grid Clear: drop every photo (panes and board stickers) from all workspaces; layouts stay. */
  clearGridPhotos: () => {
    const s = get()
    const any = s.workspaces.some(w => (w.stickers?.length ?? 0) > 0 || leafList(w.root).some(l => l.photoId))
    if (!any)
      return
    commit('clearGridPhotos')
    set(st => ({
      workspaces: st.workspaces.map(w => ({ ...w, root: clearTreePhotos(w.root), stickers: [] })),
      ...clearedSelection,
    }))
  },

  resetAllWorkspaces: () => {
    commit('resetAllWorkspaces')
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
    // A label saved while glow was still a third theme hydrates as the default
    // theme plus the glow effect (see `normalizeLabelGlow`), so every label in
    // memory speaks the current model.
    const lift = (list: Workspace[]) => list.map((w) => {
      const ws = migrateWorkspaceInserts(w, session.photos)
      const labels = ws.labels ?? []
      const migrated = labels.map(normalizeLabelGlow)
      return migrated.some((lab, i) => lab !== labels[i]) ? { ...ws, labels: migrated } : ws
    })
    const parkedBoards: Record<string, ParkedBoard<Workspace>> = {}
    for (const [id, board] of Object.entries(hydrated.parked))
      parkedBoards[id] = { workspaces: lift(board.workspaces), activeId: board.activeId }
    const workspaces = lift(hydrated.workspaces)
    // Legacy photos carry no kind, and every sticker of theirs was just a PNG
    // in the library: they land as photos (see `normalizePhotoKinds`). Orphaned
    // snapshots nothing draws any more are dropped here, the one moment the
    // history is empty, so no undo can want them back.
    const opened = [
      ...workspaces,
      ...Object.values(parkedBoards).flatMap(b => b.workspaces),
    ]
    const photos = gcRetired(
      normalizePhotoRecipes(normalizePhotoKinds(session.photos)),
      new Set(referenceCounts(opened, [session.meta.bgImage?.photoId]).keys()),
    )
    set({
      ...session.meta,
      grids: hydrated.grids,
      activeGridId: hydrated.activeGridId,
      parkedBoards,
      workspaces,
      activeId: hydrated.activeId,
      photos,
      // Sessions saved before the sticker manager have no folders.
      stickerFolders: session.meta.stickerFolders ?? [],
      // Sessions saved before tagging have no tags; a tag a photo still wears
      // but the saved list lost is unioned back in (see `normalizeTagList`).
      photoTags: normalizeTagList(session.meta.photoTags ?? [], photos),
      // Sessions saved before one-tap cutout have no map.
      cutouts: pruneCutouts(session.meta.cutouts ?? {}, new Set(photos.map(p => p.id))),
      cutoutSets: pruneCutoutSets(normalizeCutoutSets(session.meta.cutoutSets), new Set(photos.map(p => p.id))),
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
    for (const p of photos) {
      if (p.trueW > 0)
        continue
      void probePhotoDims(p.file).then((d) => {
        if (!d)
          return
        set(s => ({ photos: withPhotoDims(s.photos, p.id, d) }))
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
    commit('split')
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
      rot: src.rot,
      flipX: src.flipX,
      flipY: src.flipY,
      filter: src.filter,
      stickers: [],
      label: null,
    })
    commit('duplicatePane')
    runPaneMorph([], () =>
      set({ workspaces: mapActive(s, w => ({ ...w, root, focusId: created.id })) }))
  },

  /** Empty one pane back to a blank half of the canvas (label and stickers included). */
  resetPane: (paneId) => {
    if (!findLeaf(activeWs(get()).root, paneId))
      return
    commit('resetPane')
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        root: updateLeafIn(w.root, paneId, {
          photoId: null,
          zoom: 1,
          cx: 0.5,
          cy: 0.5,
          rot: 0,
          flipX: false,
          flipY: false,
          filter: undefined,
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
          rot: leaf.rot,
          flipX: leaf.flipX,
          flipY: leaf.flipY,
          filter: leaf.filter,
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
    commit('pastePane')
    set(st => ({
      workspaces: mapActive(st, w => ({
        ...w,
        root: updateLeafIn(w.root, paneId, {
          photoId: clip.photoId,
          zoom: clip.zoom,
          cx: clip.cx,
          cy: clip.cy,
          rot: clip.rot ?? 0,
          flipX: clip.flipX ?? false,
          flipY: clip.flipY ?? false,
          filter: clip.filter,
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
    commit('closeOtherPanes')
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
    commit('closeEmptyPanes')
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
    commit('closePane')
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
    commit('deletePane')
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
    commit('removePhoto')
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        root: updateLeafIn(w.root, paneId, {
          photoId: null,
          zoom: 1,
          cx: 0.5,
          cy: 0.5,
          rot: 0,
          flipX: false,
          flipY: false,
          filter: undefined,
          stickers: [],
        }),
      })),
    }))
  },

  swapPhotos: (a, b) => {
    const s = get()
    const ws = activeWs(s)
    const root = swapLeafContents(ws.root, a, b)
    if (root === ws.root)
      return
    commit('swapPhotos')
    set(st => ({ workspaces: mapActive(st, w => ({ ...w, root })) }))
  },

  assign: (paneId, photoId, fit = false) => {
    const s = get()
    const ws = activeWs(s)
    if (!findLeaf(ws.root, paneId))
      return false

    // A composed card placed whole: the same contain/cover ratio the Fit
    // command uses, resolved in the same commit so undo steps back once.
    let zoom = 1
    if (fit) {
      const photo = s.photos.find(p => p.id === photoId)
      if (photo?.trueW && photo.trueH) {
        const view = computeLayout(ws.root, ws.canvasRatio, ws.canvasFill, 1000, 1000, 0, 0, 0)
        const rect = view.leaves.find(l => l.node.id === paneId)?.rect
        if (rect) {
          const cover = Math.max(rect.w / photo.trueW, rect.h / photo.trueH)
          const contain = Math.min(rect.w / photo.trueW, rect.h / photo.trueH)
          zoom = Math.max(MIN_ZOOM, contain / cover)
        }
      }
    }

    commit('assign')
    set(st => ({
      workspaces: mapActive(st, w => ({
        ...w,
        root: updateLeafIn(w.root, paneId, {
          photoId,
          zoom,
          cx: 0.5,
          cy: 0.5,
          rot: 0,
          flipX: false,
          flipY: false,
          filter: undefined,
          stickers: [],
        }),
        focusId: paneId,
      })),
    }))
    return true
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
        rot: 0,
        flipX: false,
        flipY: false,
        filter: undefined,
        stickers: [],
      })
      focusId = leaf.id
    }
    if (next === ws.root)
      return
    commit('assignMany')
    set(st => ({ workspaces: mapActive(st, w => (w.id === ws.id ? { ...w, root: next, focusId } : w)) }))
  },

  /** Panning and zooming a pane streams patches: one gesture is one undo step. */
  updateLeaf: (paneId, patch) => {
    commit(`updateLeaf:${paneId}`)
    set(s => ({ workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, patch) })) }))
  },

  /**
   * The drawer's rotation dial streams angles: one gesture is one undo step
   * (tag `rotatePane:<id>`, coalesced like a sticker's rotation handle). The
   * angle is wrapped, so a full turn comes back as the 0° it looks like.
   */
  rotatePane: (paneId, rot) => {
    const leaf = findLeaf(activeWs(get()).root, paneId)
    if (!leaf)
      return
    const next = wrapAngle(rot)
    if (next === rotationOf(leaf))
      return
    commit(`rotatePane:${paneId}`)
    set(s => ({ workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, { rot: next }) })) }))
  },

  /** Mirror a pane's photo on one axis; one tap, one undo step. */
  flipPane: (paneId, axis) => {
    const leaf = findLeaf(activeWs(get()).root, paneId)
    if (!leaf)
      return
    const patch: Partial<Leaf> = axis === 'x' ? { flipX: !leaf.flipX } : { flipY: !leaf.flipY }
    commit('flipPane')
    set(s => ({ workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, patch) })) }))
  },

  /**
   * Set or clear a pane's texture filter: one tap, one undo step (a discrete
   * tag, so a quick second tap is a step of its own). Clearing stores
   * `undefined` so an untouched pane and a cleared one serialize the same, and
   * so a session round-trip cannot resurrect it.
   */
  setPaneFilter: (paneId, filter, tag) => {
    const leaf = findLeaf(activeWs(get()).root, paneId)
    if (!leaf || sameFilter(leaf.filter, filter))
      return
    commit(tag)
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, { filter: filter ?? undefined }) })),
    }))
  },

  /** Back upright and unflipped in one step (the dial's 0 / double-click). */
  resetPaneRotation: (paneId) => {
    const leaf = findLeaf(activeWs(get()).root, paneId)
    if (!leaf)
      return
    if (!rotationOf(leaf) && !leaf.flipX && !leaf.flipY)
      return
    commit('resetPaneRotation')
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, root: updateLeafIn(w.root, paneId, { rot: 0, flipX: false, flipY: false }) })),
    }))
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
    // Stickers are decoration, never a pane's photo. Photos and music cards
    // are both images, so the fill draws from the pane pool.
    const pool = paneAssetsOf(s.photos)
    if (!pool.length)
      return
    let k = 0
    const ws = activeWs(s)
    let next = ws.root
    for (const leaf of leafList(ws.root)) {
      if (leaf.photoId)
        continue
      const p = pool[k++ % pool.length]
      next = updateLeafIn(next, leaf.id, { photoId: p.id, zoom: 1, cx: 0.5, cy: 0.5, filter: undefined })
    }
    if (next === ws.root)
      return
    commit('autoFill')
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
  resetSettings: () => set({ ...SETTINGS_DEFAULTS }),

  /** Dragging the canvas handle streams sizes: one gesture is one undo step. */
  setCanvasSize: (ratio, fill) => {
    commit('setCanvasSize')
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        canvasRatio: Math.min(MAX_CANVAS_RATIO, Math.max(MIN_CANVAS_RATIO, ratio)),
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
    commit('moveWorkspace')
    set({ workspaces: next })
  },

  addSticker: (photoId, x = 0.5, y = 0.5) => {
    commit('addSticker')
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
    commit('removeSticker')
    set(s => ({
      workspaces: mapActive(s, w => ({
        ...w,
        stickers: (w.stickers ?? []).filter(t => t.id !== stickerId),
      })),
      stickerSel: s.stickerSel?.stickerId === stickerId ? null : s.stickerSel,
    }))
  },

  addLabel: (x = 0.5, y = 0.5, init) => {
    // `init` lets a command insert a finished label (location text + pin icon)
    // in the same commit that adds it: one undo step, like a plain Text add.
    const fresh = newLabel(x, y)
    const label: PaneLabel = { ...fresh, ...init, id: fresh.id }
    commit('addLabel')
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
    commit('removeLabel')
    set(s => ({
      workspaces: mapActive(s, w => ({ ...w, labels: (w.labels ?? []).filter(l => l.id !== labelId) })),
      labelSel: s.labelSel === labelId ? null : s.labelSel,
    }))
  },

  // ---- music cards (a library surface, outside the board history) ----------

  /** Close the one app-wide music card dialog, or open it from the library. */
  setMusicCardOpen: open => set(st => ({ musicCardOpen: open, musicCardFor: open ? st.musicCardFor : null })),

  /**
   * Open the dialog with a pane to place the finished card into. A stale id
   * falls back to the library-only path.
   */
  openMusicCard: paneId => set({
    musicCardOpen: true,
    musicCardFor: paneId && findLeaf(activeWs(get()).root, paneId) ? paneId : null,
  }),

  /**
   * Append a card the music tool already rendered. It is a complete square PNG,
   * so this action probes nothing, reads no EXIF, fills no pane and pushes no
   * undo entry; library edits are outside the board history.
   */
  addMusicCard: (file, meta) => {
    const photo: Photo = {
      id: uid('m'),
      name: file.name,
      file,
      kind: 'music',
      music: meta,
      trueW: MUSIC_CARD_SIZE,
      trueH: MUSIC_CARD_SIZE,
    }
    set(s => ({ photos: [...s.photos, photo] }))
    return photo
  },

  // ---- sticker management (a library surface, outside the board history) ---

  /**
   * Create a sticker folder. Folder edits are library actions, not board
   * mutations: like `clearLibrary` they push no undo entry (they are not in
   * `UNDO_SLICES`), so one ⌘Z after moving a sticker still undoes the board
   * change before it. False when the name is blank or already taken.
   */
  addStickerFolder: (name) => {
    const res = addFolder(get().stickerFolders, name)
    if (!res.ok)
      return false
    set({ stickerFolders: res.folders })
    return true
  },

  /**
   * Rename one folder and carry its stickers over. The stickers are repointed
   * by name, so the folder list and the assets can never disagree.
   */
  renameStickerFolder: (from, to) => {
    const s = get()
    const res = renameFolder(s.stickerFolders, from, to)
    if (!res.ok)
      return false
    set({
      stickerFolders: res.folders,
      photos: from === res.name ? s.photos : s.photos.map(p => (folderOf(p) === from ? withFolder(p, res.name) : p)),
    })
    return true
  },

  /** Delete a folder; its stickers fall back to Unsorted (nothing is lost). */
  deleteStickerFolder: (name) => {
    const s = get()
    if (!s.stickerFolders.includes(name))
      return
    set({
      stickerFolders: deleteFolder(s.stickerFolders, name),
      photos: s.photos.map(p => (folderOf(p) === name ? withFolder(p, '') : p)),
    })
  },

  /** Move one sticker to a folder ('' = Unsorted). A folder must exist to be picked. */
  moveStickerToFolder: (photoId, folder) => {
    const s = get()
    const name = folder.trim()
    if (name && !s.stickerFolders.includes(name))
      return
    set({
      photos: s.photos.map(p => (p.id === photoId && p.kind === 'sticker'
        ? withFolder(p, name)
        : p)),
    })
  },

  /**
   * Delete a sticker asset. Placed copies are snapshots and keep drawing: the
   * preview and the exporter resolve a sticker through the photos map, so an
   * asset that is still referenced is kept as an orphaned record (hidden from
   * every list) instead of being dropped, and is collected once nothing
   * references it any more (see lib/stickerLibrary).
   */
  deleteStickerAsset: (photoId) => {
    const s = get()
    const photo = s.photos.find(p => p.id === photoId)
    if (!photo || photo.kind !== 'sticker')
      return
    // `retirePhoto` also covers the second ask about a snapshot that has since
    // lost its last reference: the id leaves the library for good then.
    set(retireAsset(s, photoId))
  },

  // ---- photo tags (the photo page's library state) ------------------------

  /** Create a tag; false when the name is blank or taken (case-insensitively). */
  addPhotoTag: (name) => {
    const res = addTag(get().photoTags, name)
    if (!res.ok)
      return false
    set({ photoTags: res.tags })
    return true
  },

  /** Rename a tag and repoint every photo wearing it; false when refused. */
  renamePhotoTag: (from, to) => {
    const s = get()
    const res = renameTag(s.photoTags, from, to)
    if (!res.ok)
      return false
    set({
      photoTags: res.tags,
      photos: from === res.name ? s.photos : retag(s.photos, from, res.name),
    })
    return true
  },

  /** Delete a tag; it comes off every photo and the photos themselves stay. */
  deletePhotoTag: (name) => {
    const s = get()
    if (!s.photoTags.includes(name))
      return
    set({ photoTags: deleteTag(s.photoTags, name), photos: untagAll(s.photos, name) })
  },

  /**
   * Put a tag on one photo. Unlike a sticker's folder (which has to exist
   * before a sticker can move into it), a tag typed on a photo joins the list
   * on the spot: tagging is where tags are invented.
   */
  tagPhoto: (photoId, name) => {
    const s = get()
    const tag = resolveTag(s.photoTags, name)
    if (!tag || !s.photos.some(p => p.id === photoId))
      return
    const res = addTag(s.photoTags, tag)
    set({
      photoTags: res.ok ? res.tags : s.photoTags,
      photos: s.photos.map(p => (p.id === photoId ? withTag(p, tag) : p)),
    })
  },

  /** Take one tag off one photo (the tag itself stays in the list). */
  untagPhoto: (photoId, name) => {
    set(s => ({ photos: s.photos.map(p => (p.id === photoId ? withoutTag(p, name) : p)) }))
  },

  /**
   * Delete a photo asset. The same snapshot rule as a sticker's: a photo a
   * board still draws stays as an orphaned record (hidden from every list) so
   * the pane keeps rendering, and is collected once nothing references it.
   */
  deletePhotoAsset: (photoId) => {
    const s = get()
    const photo = s.photos.find(p => p.id === photoId)
    if (!photo || photo.kind === 'sticker')
      return
    set(retireAsset(s, photoId))
  },

  /**
   * Attach the maker's recipe to a made sticker (see lib/stickerRecipe). It is
   * written once, at save time, and never edited: it is the sticker's record of
   * how it was drawn, not a control the page tunes afterwards.
   */
  setStickerRecipe: (photoId, recipe) => {
    set(s => ({
      photos: s.photos.map(p => (p.id === photoId && p.kind === 'sticker' ? { ...p, recipe } : p)),
    }))
  },

  /** Step back one board mutation (session-only; see lib/history). */
  /** Step back to the parent step (session-only; see lib/history). */
  undo: () =>
    set((s) => {
      const step = stepUp(s.history, snapshotOf(s))
      if (!step)
        return {}
      return { ...restoreSnapshot(s, step.snapshot), history: step.history }
    }),

  /** Step forward into the child visited last. The move records nothing. */
  redo: () =>
    set((s) => {
      const step = stepDown(s.history, snapshotOf(s))
      if (!step)
        return {}
      return { ...restoreSnapshot(s, step.snapshot), history: step.history }
    }),

  /**
   * Jump to any step of the tree (the history panel's rows): one move, so it
   * records no step of its own, and the board it restores is the step exactly.
   */
  jumpTo: id =>
    set((s) => {
      const step = jump(s.history, id, snapshotOf(s))
      if (!step)
        return {}
      return { ...restoreSnapshot(s, step.snapshot), history: step.history }
    }),

  /** Forget the tree: a replaced board (session hydrate, opened file) starts clean. */
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
  // Annotated so zustand does not infer the store type from the settings
  // shape; the spread keeps the payload a plain record, which is what
  // `migrateSettings` returns and what zustand hands back to `merge`.
  partialize: (state: State & Actions) => ({ ...partializeSettings(state) }),
}))

/**
 * Capture the undoable slices before an action mutates them. Every mutating
 * action calls this *after* its own no-op guard, so an action that changes
 * nothing never records a step. `tag` names the step in the history panel and
 * collapses a gesture's stream of mutations into the single step undo returns
 * to (see lib/history).
 */
function commit(tag: string | null = null): void {
  useStore.setState(s => ({ history: record(s.history, snapshotOf(s), Date.now(), tag) }))
}

interface Actions {
  addPhotos: (files: File[], autoFill?: boolean, kind?: PhotoKind) => Photo[]
  duplicatePane: (paneId: string, dir: 'row' | 'column') => void
  resetPane: (paneId: string) => void
  copyPane: (paneId: string) => void
  pastePane: (paneId: string) => void
  closeOtherPanes: (paneId: string) => void
  closeEmptyPanes: () => void
  openStickerMaker: (paneId: string | null) => void
  /** Close the one app-wide music card dialog, or open it from the library. */
  setMusicCardOpen: (open: boolean) => void
  /** Open the dialog, placing the finished card into `paneId` when it exists. */
  openMusicCard: (paneId: string | null) => void
  /** Append a rendered music card to the library; returns its record. */
  addMusicCard: (file: File, meta: MusicMeta) => Photo
  clearLibrary: () => void
  resetWorkspace: (id: string) => void
  /** Returns the new workspace's id, or null when the board is full. */
  addWorkspace: (kind?: CardKind) => string | null
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
  /** Place a photo in a pane; `fit` contains the whole image instead of cover. */
  assign: (paneId: string, photoId: string, fit?: boolean) => boolean
  assignMany: (photoIds: string[]) => void
  removePhoto: (paneId: string) => void
  /** Swap two panes' contents: photo, view, stickers and label. */
  swapPhotos: (a: string, b: string) => void
  updateLeaf: (paneId: string, patch: Partial<Leaf>) => void
  /** Turn a pane's photo (radians, wrapped); a drag streams and coalesces. */
  rotatePane: (paneId: string, rot: number) => void
  /** Mirror a pane's photo on one axis. */
  flipPane: (paneId: string, axis: 'x' | 'y') => void
  /** Back upright and unflipped in one step. */
  resetPaneRotation: (paneId: string) => void
  /**
   * Apply one texture filter setting to the pane's photo, or null to clear it.
   * The value is atomic: an id plus the knobs the pixel filters dial. `tag`
   * coalesces a parameter drag into one undo step.
   */
  setPaneFilter: (paneId: string, filter: FilterValue | null, tag?: string) => void
  focus: (paneId: string) => void
  focusNeighbor: (dir: FocusDir) => void
  selectLabel: (labelId: string | null) => void
  selectSticker: (sel: { stickerId: string } | null) => void
  requestLabelEdit: (labelId: string) => void
  setToolsDockMode: (mode: ToolsDockMode) => void
  autoFill: () => void
  patch: (p: Partial<State>) => void
  /** Step back / forward over the board's steps (see lib/history). */
  undo: () => void
  redo: () => void
  /** Move the cursor to any step of the tree (the history panel). */
  jumpTo: (id: string) => void
  /** Drop the tree: a replaced board has nothing earlier to return to. */
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
  addLabel: (x?: number, y?: number, init?: Partial<PaneLabel>) => string
  setLabel: (labelId: string, patch: Partial<PaneLabel>) => void
  removeLabel: (labelId: string) => void
  /** Create a sticker folder; false when the name is blank or taken. */
  addStickerFolder: (name: string) => boolean
  /** Rename a sticker folder and repoint its stickers; false when refused. */
  renameStickerFolder: (from: string, to: string) => boolean
  /** Delete a sticker folder; its stickers fall back to Unsorted. */
  deleteStickerFolder: (name: string) => void
  /** Move one sticker asset to a folder ('' = Unsorted). */
  moveStickerToFolder: (photoId: string, folder: string) => void
  /** Delete a sticker asset, keeping the copies already placed on a board. */
  deleteStickerAsset: (photoId: string) => void
  /** Record how a made sticker was drawn, so the page can reopen it. */
  setStickerRecipe: (photoId: string, recipe: StickerRecipe) => void
  /** Create a photo tag; false when the name is blank or taken. */
  addPhotoTag: (name: string) => boolean
  /** Rename a photo tag and repoint the photos wearing it; false when refused. */
  renamePhotoTag: (from: string, to: string) => boolean
  /** Delete a photo tag; it comes off every photo. */
  deletePhotoTag: (name: string) => void
  /** Put a tag on one photo, adding it to the tag list when it is new. */
  tagPhoto: (photoId: string, name: string) => void
  /** Take one tag off one photo. */
  untagPhoto: (photoId: string, name: string) => void
  /** Delete a photo asset, keeping the copies already placed on a board. */
  deletePhotoAsset: (photoId: string) => void
}
