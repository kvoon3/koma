import { createContext } from 'react'

/**
 * Where compact panes portal their stage-seated minimap. The host belongs to
 * the stage, outside the canvas transform, so the chip stays a fixed overlay
 * while the board zooms. It sits outside `Pane` because that component module
 * may export only components.
 */
export const MinimapHostContext = createContext<HTMLElement | null>(null)
