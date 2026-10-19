import type { CutoutMap } from './cutout'
import { originalOf } from './cutout'

/**
 * The three states a photo's cutout can be in, as library assets (pure
 * bookkeeping, unit-tested). The dock's Cut out menu reads them and the side
 * effects (model run, bake, pane swap) live in `lib/paneCutout`.
 *
 * ## The asset graph
 *
 * One cut produces up to three PHOTOS, all of them ordinary library assets:
 *
 *   source S ──cut──▶ cutout C (PNG, alpha: the subject with a hole around it)
 *      │                  │
 *      └──blur(C, preview(S))──▶ blurred B (PNG: C over S's blurred frame)
 *
 * `CutoutMap` (the older record) answers "what was this cut from": C → S and
 * B → S, so Original always resolves. `CutoutSets` answers "what else exists
 * for this source": keyed by the SOURCE id, it names the cutout and the
 * blurred composite of that one cut, which is what lets the menu switch
 * between the three states without re-running the model or guessing from
 * file names.
 *
 * Everything the menu needs is therefore in the library: switching states is
 * a `photoId` swap, and the blurred composite can be rebaked after a reload
 * from S's decoded preview (≤1800px, `lib/imageStore`) plus C's own PNG, which
 * is exactly the pair `lib/cutoutBackdrop.bakeBlurredBackdrop` takes.
 *
 * ## Older saves
 *
 * A session saved before this table existed carries only `CutoutMap`, so a
 * photo that has an original resolves as its own cutout row (adoption): the
 * menu shows Transparent active and can bake the blurred variant from the
 * pair above. Nothing has to be migrated eagerly.
 */

/** The library assets one cut has produced. */
export interface CutoutSet {
  /** The cutout PNG: the subject, transparent everywhere else. */
  cutout: string
  /** The composite: the same cutout over its own source's blurred frame. */
  blurred?: string
}

/** Keyed by the SOURCE photo id (the photo the cut was made from). */
export type CutoutSets = Record<string, CutoutSet>

export type CutoutState = 'original' | 'cutout' | 'blurred'

export interface CutoutVariants {
  /** The photo the cut was made from, when it is still in the library. */
  source: string | null
  /** The cutout PNG to switch to, when it exists and is still in the library. */
  cutout: string | null
  /** The blurred composite to switch to, when one was baked and is still there. */
  blurred: string | null
  /** Which of the three `photoId` itself is. */
  state: CutoutState
}

/** Is a photo still in the library (orphaned snapshots count: they still render)? */
export type HasPhoto = (photoId: string) => boolean

/**
 * What the menu can offer for a pane showing `photoId`: the source behind it,
 * its cutout and its blurred composite, and which of the three it currently is.
 *
 * `has` filters dead assets: a variant that left the library is not offered,
 * and a source that is gone leaves Original disabled (the pane may still show
 * an orphaned cutout of it).
 */
export function variantsOf(cutouts: CutoutMap, sets: CutoutSets, photoId: string, has: HasPhoto): CutoutVariants {
  const cutFrom = originalOf(cutouts, photoId)
  const source = cutFrom ?? photoId
  const set = sets[source]
  const registered = set?.cutout
  // A cutout with no entry in the table (an older save) is its own row.
  const adopted = cutFrom && has(photoId) ? photoId : null
  const cutout = registered && has(registered) ? registered : adopted
  const blurred = set?.blurred && has(set.blurred) ? set.blurred : null
  // Which of the three THIS photo is: the composite, the cutout, or the
  // source (a photo with a cutout row can still be the original itself).
  const state: CutoutState = photoId === blurred
    ? 'blurred'
    : photoId === cutout ? 'cutout' : 'original'
  return { source: has(source) ? source : null, cutout, blurred, state }
}

/** Record a fresh cutout for `sourceId` (a re-cut replaces the row, keeping any blurred composite). */
export function recordCutoutSet(sets: CutoutSets, sourceId: string, cutoutId: string): CutoutSets {
  const prev = sets[sourceId]
  return { ...sets, [sourceId]: prev?.blurred ? { cutout: cutoutId, blurred: prev.blurred } : { cutout: cutoutId } }
}

/** Record the blurred composite baked from that cutout. */
export function recordBlurredSet(sets: CutoutSets, sourceId: string, cutoutId: string, blurredId: string): CutoutSets {
  return { ...sets, [sourceId]: { cutout: cutoutId, blurred: blurredId } }
}

/** The table without the entries a hydration dropped from the library. */
export function pruneCutoutSets(sets: CutoutSets, liveIds: ReadonlySet<string>): CutoutSets {
  const next: CutoutSets = {}
  for (const [sourceId, set] of Object.entries(sets)) {
    if (!liveIds.has(sourceId))
      continue
    const cutout = liveIds.has(set.cutout) ? set.cutout : null
    const blurred = set.blurred && liveIds.has(set.blurred) ? set.blurred : undefined
    // A row with no cutout left has nothing to offer; drop it rather than
    // keep a hole the menu would have to render.
    if (cutout)
      next[sourceId] = blurred ? { cutout, blurred } : { cutout }
  }
  return next
}

/** Every set that points at, or belongs to, a photo that left the library. */
export function dropCutoutSetRefs(sets: CutoutSets, photoId: string): CutoutSets {
  const next: CutoutSets = {}
  for (const [sourceId, set] of Object.entries(sets)) {
    if (sourceId === photoId)
      continue
    const cutout = set.cutout === photoId ? null : set.cutout
    const blurred = set.blurred === photoId ? undefined : set.blurred
    if (cutout)
      next[sourceId] = blurred ? { cutout, blurred } : { cutout }
  }
  return next
}

/** Validate the table from a session or a `.koma.json`; anything malformed is dropped. */
export function normalizeCutoutSets(raw: unknown): CutoutSets {
  if (!raw || typeof raw !== 'object')
    return {}
  const next: CutoutSets = {}
  for (const [sourceId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!sourceId || !value || typeof value !== 'object')
      continue
    const { cutout, blurred } = value as { cutout?: unknown, blurred?: unknown }
    if (typeof cutout !== 'string' || !cutout)
      continue
    next[sourceId] = typeof blurred === 'string' && blurred ? { cutout, blurred } : { cutout }
  }
  return next
}
