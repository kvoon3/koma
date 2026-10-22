import type { Photo } from './imageStore'
import { photoAssetsOf, stickerAssetsOf } from './stickerLibrary'

export interface LibraryKind {
  readonly type: string
  /** English source string, passed through `t`. */
  readonly label: string
  /** Live assets of this kind: retired snapshots and other kinds excluded. */
  readonly assets: (photos: readonly Photo[]) => Photo[]
}

export const LIBRARY_KINDS = [
  { type: 'photo', label: 'Photos', assets: photoAssetsOf },
  { type: 'sticker', label: 'Stickers', assets: stickerAssetsOf },
] as const satisfies readonly LibraryKind[]

export type LibraryType = (typeof LIBRARY_KINDS)[number]['type']
export type LibraryFilter = 'all' | LibraryType
/** null = every asset, '' = Untagged/Unsorted, else the tag/folder name. */
export type GroupPick = null | '' | string
export interface LibrarySearch { type?: LibraryType }

export function parseLibraryType(raw: unknown): LibraryType | undefined {
  return typeof raw === 'string' && LIBRARY_KINDS.some(kind => kind.type === raw)
    ? raw as LibraryType
    : undefined
}

export function libraryAssets(photos: readonly Photo[]): Record<LibraryType, Photo[]> {
  const out = {} as Record<LibraryType, Photo[]>
  for (const kind of LIBRARY_KINDS)
    out[kind.type] = kind.assets(photos)
  return out
}

export function libraryCounts(assets: Readonly<Record<LibraryType, Photo[]>>): Record<LibraryType, number> {
  const out = {} as Record<LibraryType, number>
  for (const kind of LIBRARY_KINDS)
    out[kind.type] = assets[kind.type].length
  return out
}

export function libraryTotal(counts: Readonly<Record<LibraryType, number>>): number {
  return LIBRARY_KINDS.reduce((sum, kind) => sum + counts[kind.type], 0)
}

/** A pick that still names a live group; a vanished tag/folder falls back to null. */
export function validGroup(pick: GroupPick, groups: readonly string[]): GroupPick {
  return pick == null || pick === '' || groups.includes(pick) ? pick : null
}

/** A kind's pick only applies while that kind is the one on screen. On All no group bar is drawn, so an invisible filter must not narrow a grid. */
export function livePick(filter: LibraryFilter, type: LibraryType, pick: GroupPick): GroupPick {
  return filter === type ? pick : null
}

export function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase()
}

export function matchesQuery(asset: Photo, normalized: string): boolean {
  return !normalized || asset.name.toLocaleLowerCase().includes(normalized)
}

export interface LibrarySectionProps {
  /** Every live asset of this kind, search and pick NOT applied. */
  items: readonly Photo[]
  /** Photo tags or sticker folders, in chip order. */
  groups: string[]
  /** Already normalized and gated by livePick. */
  pick: GroupPick
  onPick: (pick: GroupPick) => void
  /** Raw header search text; the section normalizes once. */
  query: string
  /** True when this kind is the only one on screen, so its chip bar is drawn. */
  solo: boolean
}
