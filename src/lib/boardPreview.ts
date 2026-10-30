import type { Node, PaneLabel, Sticker } from './panes'
import { leafList } from './panes'

/** One cell of a board, in the shape the groups page and wallpaper read. */
export interface BoardCell {
  id: string
  root: Node
  canvasRatio: number | null
  stickers?: Sticker[]
  labels?: PaneLabel[]
}

/**
 * The photos the groups page wallpaper draws: the first photo in each cell, one
 * per photo so two cells showing the same picture do not blur it twice. Empty
 * cells contribute nothing.
 */
export function wallpaperPhotoIds(board: readonly BoardCell[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const cell of board) {
    const photoId = leafList(cell.root).find(leaf => leaf.photoId)?.photoId
    if (!photoId || seen.has(photoId))
      continue
    seen.add(photoId)
    ids.push(photoId)
  }
  return ids
}
