/**
 * The routes, in one place.
 *
 * `/` is the hub: the app's root is a launcher with three destinations (grid
 * making, photo management, sticker management). The board overview it used to
 * be is `#/grid`, the editor is `#/w/<id>` (unchanged: a deep link into a board
 * still opens it), and the two libraries are one route each. The split keeps
 * the root honest, since it is what a link to the app should land on, while
 * every older deep link keeps working.
 *
 * The predicates are what the chrome keys off: `isGridPath` is the board
 * overview (pure navigation, no photo tools, export in batch mode), and
 * `isHubPath` is "no board is drawn here" (the board's floating actions and
 * key map are inert on those routes).
 */
export const HUB_PATH = '/'
export const GRID_PATH = '/grid'
export const PHOTOS_PATH = '/photos'
export const STICKERS_PATH = '/stickers'

/** The 3×3 board overview. */
export function isGridPath(path: string): boolean {
  return path === GRID_PATH
}

/** A hub destination: the hub itself or one of the two library pages. */
export function isHubPath(path: string): boolean {
  return path === HUB_PATH || path === PHOTOS_PATH || path === STICKERS_PATH
}
