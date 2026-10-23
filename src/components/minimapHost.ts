import { createContext, use } from 'react'

/**
 * Where compact panes portal their stage-seated minimap. The host belongs to
 * the stage, outside the canvas transform, so the chip stays a fixed overlay
 * while the board zooms; its own module keeps Stage and Pane from importing
 * each other.
 */
export const MinimapHostContext = createContext<HTMLElement | null>(null)

export function useMinimapHost() {
  return use(MinimapHostContext)
}
