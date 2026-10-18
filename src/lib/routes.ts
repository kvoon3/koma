/**
 * The routes, in one place.
 *
 * `/` is the 3×3 board overview, as it always was: the app opens on its boards.
 * `/w/<id>` is the editor (a deep link opens the board it names), and `/photos`
 * and `/stickers` are the two libraries. `#/legacy-index` holds the launcher
 * that was drafted while the hub root was under review; it is routable and
 * works, but nothing in the app links to it (see `components/LegacyIndex`).
 *
 * The predicates are what the chrome keys off: `isGridPath` is the board
 * overview (pure navigation, no photo tools, export in batch mode), and
 * `isHubPath` is "no board is drawn here": the two libraries and the retained
 * launcher, never the overview. The board's floating actions are hidden and its
 * key map is inert on those routes, which is the pre-hub behaviour for the two
 * library pages, with the launcher joining them.
 */
export const OVERVIEW_PATH = '/'
export const EDITOR_PATH = '/w/$wsId'
export const PHOTOS_PATH = '/photos'
export const STICKERS_PATH = '/stickers'
/** The launcher draft, kept off the main flow: routable, linked from nowhere. */
export const LEGACY_INDEX_PATH = '/legacy-index'

/** The 3×3 board overview, at the app's root. */
export function isGridPath(path: string): boolean {
  return path === OVERVIEW_PATH
}

/** A library (or the retired launcher): no board is drawn here. */
export function isHubPath(path: string): boolean {
  return path === PHOTOS_PATH || path === STICKERS_PATH || path === LEGACY_INDEX_PATH
}
