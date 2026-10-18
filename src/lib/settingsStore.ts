/**
 * The persisted-settings ceremony for `collage:settings` (see zustand's
 * `persist`): the visual defaults, the shapes the saved payload may hold, the
 * sanitize lists and the version migration. No store and no DOM, so the
 * migration that must never lose a user's dock mode or background stays
 * unit-testable (`settingsMigrate.test.ts`). The store re-exports everything
 * here, so the rest of the app still reads it through `src/store.ts`.
 */
import type { BgImage } from './collageBg'
import type { GridCellRatio } from './gridTools'
import { GRID_CELL_RATIO, isGridCellRatio } from './gridTools'

/**
 * Bottom tools sheet display: icon-only single row / icon + label single row /
 * wrapped multi-row. There is no put-away state: the sheet is always on
 * screen, the smallest display only drops the labels (see toolsDockMode.ts).
 */
export type ToolsDockMode = 'icons' | 'row' | 'expanded'
export type DockBg = 'solid' | 'frosted' | 'liquid'

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

/**
 * v9: the icon-minimized 'collapsed' dock display is gone. The bump itself
 * is the fix: zustand persist only runs `migrate` when the saved version
 * differs, so an unchanged version would let a saved 'collapsed' through.
 */
export const SETTINGS_VERSION = 9

const DOCK_BGS: readonly DockBg[] = ['solid', 'frosted', 'liquid']
const DOCK_MODES: readonly ToolsDockMode[] = ['icons', 'row', 'expanded']
/** The dropped icon-minimized display, still found in saved settings. */
const LEGACY_DOCK_COLLAPSED = 'collapsed'

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
  // v3: the temporary handle-icon toggle is gone (the handle icon follows
  // the next tap; see toolsDockMode.ts).
  delete p.dockHandleIcon
  // v9: the icon-minimized state is gone. A save that still holds it lands on
  // the icon-only row, the nearest display that survived (the drawer cannot
  // be put away any more). Unconditional so any older version migrating up
  // is corrected regardless of where it was saved.
  if (p.toolsDockMode === LEGACY_DOCK_COLLAPSED)
    p.toolsDockMode = 'icons'
  if (!DOCK_MODES.includes(p.toolsDockMode as ToolsDockMode))
    p.toolsDockMode = TOOLS_DOCK_MODE
  // v8: whole-collage background layers over the gap fill; off for old saves.
  if (version < 8) {
    p.bgGradient ??= null
    p.bgImage ??= null
  }
  return p
}

/**
 * The state the localStorage payload carries: the visual settings only, one
 * key per `partializeSettings` field. Everything else (workspaces, photos) is
 * session-only (see lib/sessionStore). The store's `State` extends this, so a
 * persisted setting cannot be forgotten by the payload or the migration.
 */
export interface PersistedSettings {
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
  dockBg: DockBg
  /** Aspect of the 3×3 grid's cells (display, snapshot and per-cell export). */
  gridCellRatio: GridCellRatio
  /** Dock background opacity, 0–100 (%). */
  dockOpacity: number
  /**
   * Bottom tools sheet display. Persisted; starts in the labelled row. Drag
   * the sheet or tap the handle to move between icons / row / expanded.
   */
  toolsDockMode: ToolsDockMode
}

/**
 * The visual settings at their defaults: the store's initial state and the
 * settings drawer's Reset target. The dock display and the grid cell aspect
 * are not part of the reset (they are layout choices, not knobs), so they are
 * not in here; both call sites set them explicitly.
 */
export const SETTINGS_DEFAULTS: Omit<PersistedSettings, 'gridCellRatio' | 'toolsDockMode'> = {
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
}

/** The zustand `partialize` payload: exactly the settings `State` persists. */
export function partializeSettings(state: PersistedSettings): PersistedSettings {
  return {
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
  }
}
