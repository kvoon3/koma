import type { CloudAssetSummary } from './cloudApi'
import type { SessionPhotoRecord } from './sessionStore'
import { isAssetId, motionAssetId } from './assetKeys'
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
  const motion = record.videoFile === undefined ? null : motionAssetId(record.id)
  return {
    ...(record.kind === undefined ? {} : { kind: record.kind }),
    ...(record.folder === undefined ? {} : { folder: record.folder }),
    ...(record.music === undefined ? {} : { music: record.music }),
    ...(record.tags === undefined ? {} : { tags: record.tags }),
    ...(record.orphaned === undefined ? {} : { orphaned: record.orphaned }),
    ...(record.recipe === undefined ? {} : { recipe: record.recipe }),
    ...(record.gps === undefined ? {} : { gps: record.gps }),
    ...(record.takenAt === undefined ? {} : { takenAt: record.takenAt }),
    ...(motion === null ? {} : { motionAssetId: motion }),
  }
}

/** The motion asset a still's `meta` points at, or null when it has none. */
export function motionAssetIdFromMeta(meta: string | null): string | null {
  if (meta === null)
    return null
  try {
    const raw: unknown = JSON.parse(meta)
    if (!isRecord(raw) || typeof raw.motionAssetId !== 'string')
      return null
    return isAssetId(raw.motionAssetId) ? raw.motionAssetId : null
  }
  catch {
    return null
  }
}

/**
 * Whether the still row must be POSTed. A still the account already has is
 * rewritten when a new motion file arrives, so `meta.motionAssetId` lands on
 * the same save that uploads `{id}~motion`. Skipping that rewrite leaves the
 * motion object orphaned from every other device.
 */
export function stillRowNeedsWrite(
  photoId: string,
  hasMotionFile: boolean,
  known: ReadonlySet<string>,
): boolean {
  if (!known.has(photoId))
    return true
  if (!hasMotionFile)
    return false
  const motion = motionAssetId(photoId)
  return motion !== null && !known.has(motion)
}

/**
 * Local stills that should pull a cloud motion file: the document references
 * them, this device already has the still without `videoFile`, and the cloud
 * row's meta names a motion asset.
 */
export function motionFillTargets(
  referencedIds: readonly string[],
  localById: ReadonlyMap<string, { videoFile?: File | undefined }>,
  metaById: ReadonlyMap<string, string | null>,
): { photoId: string, motionId: string }[] {
  const out: { photoId: string, motionId: string }[] = []
  for (const id of referencedIds) {
    const local = localById.get(id)
    if (local === undefined || local.videoFile !== undefined)
      continue
    const motionId = motionAssetIdFromMeta(metaById.get(id) ?? null)
    if (motionId !== null)
      out.push({ photoId: id, motionId })
  }
  return out
}

/**
 * Rebuild the library record a second device needs from the row plus the
 * downloaded bytes. The server's columns win over `meta`, whose interior is
 * still untrusted, and the existing `parseSessionPhotoRecord` is the one
 * validator that decides whether the result is a record at all.
 */
export function photoRecordFromAsset(asset: CloudAssetSummary, file: File, motion?: File): SessionPhotoRecord | null {
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
    ...(motion === undefined ? {} : { videoFile: motion }),
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    trueW: asset.trueW,
    trueH: asset.trueH,
    file,
  })
}
