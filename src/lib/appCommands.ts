import type { Dispatch, SetStateAction } from 'react'
import { createContext, use } from 'react'

/**
 * The chrome commands RootLayout owns (export, drawers, help) that a menu deep
 * in the tree may want to invoke. Passed down by context so the stage's
 * background menu does not have to thread them through the route components.
 */
export interface AppCommands {
  /** Export the active view: the workspace in the editor, every non-empty workspace in the grid. */
  exportNow: () => void
  /** Render the whole 3×3 overview as one image and open it in the export dialog. */
  snapshotGrid: () => Promise<void>
  /** Export every filled grid cell as its own image, in posting order. */
  exportGridCells: () => Promise<void>
  /** Open the per-pane crop report dialog. */
  showCrops: () => void
  setLibraryOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  /** True while an export / render is running. */
  busy: boolean
  /** The grid overview is the active route. */
  grid: boolean
}

function noop() {}

export const AppCommandsContext = createContext<AppCommands>({
  exportNow: noop,
  snapshotGrid: async () => {},
  exportGridCells: async () => {},
  showCrops: noop,
  setLibraryOpen: noop,
  setSettingsOpen: noop,
  setHelpOpen: noop,
  busy: false,
  grid: false,
})

export function useAppCommands(): AppCommands {
  return use(AppCommandsContext)
}
