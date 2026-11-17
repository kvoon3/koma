import type { CloudAssetSummary } from './cloudApi'
import type { SessionPhotoRecord } from './sessionStore'
import { parseSessionPhotoRecord } from './sessionStore'

/** The three kinds an asset row may hold; the column is text, so narrow here. */
export function isCloudAssetKind(value: string): value is 'photo' | 'sticker' | 'music' {
  switch (value) {
    case 'photo':
    case 'sticker':
    case 'music':
      return true
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** One list/upload row, or null when the wire shape is not what the routes send. */
export function parseAssetSummary(value: unknown): CloudAssetSummary | null {
  if (!isRecord(value))
    return null
  const { id, kind, name, trueW, trueH, meta, createdAt } = value
  if (typeof id !== 'string' || typeof kind !== 'string' || typeof name !== 'string')
    return null
  if (!isDimension(trueW) || !isDimension(trueH) || typeof createdAt !== 'string')
    return null
  if (meta !== null && typeof meta !== 'string')
    return null
  return { id, kind, name, trueW, trueH, meta, createdAt }
}

export function parseAssetSummaryList(value: unknown): CloudAssetSummary[] {
  if (!Array.isArray(value))
    return []
  return value.flatMap((entry) => {
    const asset = parseAssetSummary(entry)
    return asset ? [asset] : []
  })
}

/**
 * The public half of a photo record, ready for the `meta` column: everything
 * but the file bytes.
 */
export function sessionPhotoMeta(record: SessionPhotoRecord): Record<string, unknown> {
  return {
    ...(record.kind === undefined ? {} : { kind: record.kind }),
    ...(record.folder === undefined ? {} : { folder: record.folder }),
    ...(record.music === undefined ? {} : { music: record.music }),
    ...(record.tags === undefined ? {} : { tags: record.tags }),
    ...(record.orphaned === undefined ? {} : { orphaned: record.orphaned }),
    ...(record.recipe === undefined ? {} : { recipe: record.recipe }),
    ...(record.gps === undefined ? {} : { gps: record.gps }),
    ...(record.takenAt === undefined ? {} : { takenAt: record.takenAt }),
  }
}

/**
 * Rebuild the library record a second device needs from the row plus the
 * downloaded bytes. The server's columns win over `meta`, whose interior is
 * still untrusted, and the existing `parseSessionPhotoRecord` is the one
 * validator that decides whether the result is a record at all.
 */
export function photoRecordFromAsset(asset: CloudAssetSummary, file: File): SessionPhotoRecord | null {
  if (!isCloudAssetKind(asset.kind))
    return null
  let meta: unknown = {}
  if (asset.meta !== null) {
    try {
      meta = JSON.parse(asset.meta)
    }
    catch {
      return null
    }
  }
  if (!isRecord(meta))
    return null
  return parseSessionPhotoRecord({
    ...meta,
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    trueW: asset.trueW,
    trueH: asset.trueH,
    file,
  })
}
