/**
 * Photo tags: short hand-typed labels a photo carries, many per photo (unlike
 * a sticker's one folder).
 *
 * Two pieces of state, as with folders: the tag list itself is session state
 * beside the photos (`photoTags`, in the store), so an empty tag survives a
 * reload and can be renamed or deleted, and each photo's `tags` array is its
 * membership. A tag a photo carries but the list does not know is not lost on
 * hydrate: `normalizeTagList` unions the two, because the list is the only
 * thing the chip bar can draw.
 *
 * Pure, so the fiddly parts (name cleaning, case-insensitive duplicates, the
 * rename / delete fan-out, per-tag counts) are unit-tested without a store.
 */
import type { Photo } from './imageStore'
import { cleanEntryName, MAX_NAME_LEN, sameEntryName } from './assetNames'

/** Tags are chips beside folder chips: the same cap keeps them readable. */
export const MAX_TAG_NAME = MAX_NAME_LEN

/** A photo's tags, in the order they were attached; absent reads as none. */
export function tagsOf(photo: Photo): string[] {
  return photo.tags ?? []
}

export function hasTag(photo: Photo, tag: string): boolean {
  return tagsOf(photo).some(t => sameEntryName(t, tag))
}

/** A photo with no tags at all: the chip bar's own bucket. */
export function isUntagged(photo: Photo): boolean {
  return tagsOf(photo).length === 0
}

/** A photo's tags with the empty array normalized away (so an untagged photo stays bare). */
function withList(photo: Photo, tags: string[]): Photo {
  return { ...photo, tags: tags.length ? tags : undefined }
}

/** Attach one tag; a tag the photo already carries (in any case) changes nothing. */
export function withTag(photo: Photo, raw: string): Photo {
  const name = cleanEntryName(raw, MAX_TAG_NAME)
  if (!name)
    return photo
  const tags = tagsOf(photo)
  if (tags.some(t => sameEntryName(t, name)))
    return photo
  return withList(photo, [...tags, name])
}

/** Detach one tag (case-insensitively); absent leaves the photo as it was. */
export function withoutTag(photo: Photo, tag: string): Photo {
  const tags = tagsOf(photo)
  const next = tags.filter(t => !sameEntryName(t, tag))
  return next.length === tags.length ? photo : withList(photo, next)
}

/** Replace a photo's whole tag list: cleaned, deduped, in the order given. */
export function setTags(photo: Photo, raw: readonly string[]): Photo {
  const out: string[] = []
  for (const entry of raw) {
    const name = cleanEntryName(entry, MAX_TAG_NAME)
    if (name && !out.some(t => sameEntryName(t, name)))
      out.push(name)
  }
  return withList(photo, out)
}

// ---- the tag list --------------------------------------------------------

/** Why a tag edit was refused: nothing typed, a name already taken, a tag that is gone. */
export type TagError = 'empty' | 'duplicate' | 'missing'

export type TagEdit
  = | { ok: true, tags: string[], name: string }
    | { ok: false, reason: TagError }

/** Add a tag to the list; the list keeps its order. */
export function addTag(tags: readonly string[], raw: string): TagEdit {
  const name = cleanEntryName(raw, MAX_TAG_NAME)
  if (!name)
    return { ok: false, reason: 'empty' }
  if (tags.some(t => sameEntryName(t, name)))
    return { ok: false, reason: 'duplicate' }
  return { ok: true, tags: [...tags, name], name }
}

/**
 * Rename one tag. Renaming it to itself (or to the same name in another case)
 * succeeds without moving anything; an unknown tag is refused.
 */
export function renameTag(tags: readonly string[], from: string, raw: string): TagEdit {
  const at = tags.findIndex(t => t === from)
  if (at === -1)
    return { ok: false, reason: 'missing' }
  const name = cleanEntryName(raw, MAX_TAG_NAME)
  if (!name)
    return { ok: false, reason: 'empty' }
  if (tags.some(t => t !== from && sameEntryName(t, name)))
    return { ok: false, reason: 'duplicate' }
  return { ok: true, tags: tags.map(t => (t === from ? name : t)), name }
}

/** Delete a tag from the list (its photos are the caller's to untag). */
export function deleteTag(tags: readonly string[], name: string): string[] {
  return tags.includes(name) ? tags.filter(t => t !== name) : [...tags]
}

/**
 * The canonical spelling of `raw` against the list: an existing tag's own
 * spelling when the list already has it (typing "trip" onto a photo that wears
 * "Trip" attaches to "Trip"), else the cleaned new name. Null when blank.
 *
 * Free-form tagging is deliberate: the tag list grows from what people type on
 * a photo, where a sticker's folder has to exist first (its chip bar is the
 * only door). The store appends what this returns to the list.
 */
export function resolveTag(tags: readonly string[], raw: string): string | null {
  const name = cleanEntryName(raw, MAX_TAG_NAME)
  if (!name)
    return null
  return tags.find(t => sameEntryName(t, name)) ?? name
}

/** The list a session needs: what it saved, plus every tag its photos still carry. */
export function normalizeTagList(saved: readonly string[], photos: readonly Photo[]): string[] {
  const out: string[] = []
  const add = (raw: string) => {
    const name = cleanEntryName(raw, MAX_TAG_NAME)
    if (name && !out.some(t => sameEntryName(t, name)))
      out.push(name)
  }
  for (const name of saved)
    add(name)
  for (const photo of photos) {
    for (const name of tagsOf(photo))
      add(name)
  }
  return out
}

// ---- membership fan-out --------------------------------------------------

/** Repoint every photo wearing `from` to `to` (a rename; nothing else moves). */
export function retag(photos: readonly Photo[], from: string, to: string): Photo[] {
  return photos.map(p => (!hasTag(p, from)
    ? p
    : setTags(p, tagsOf(p).map(t => (sameEntryName(t, from) ? to : t)))))
}

/** Take one tag off every photo (a delete; the photos themselves stay). */
export function untagAll(photos: readonly Photo[], tag: string): Photo[] {
  return photos.map(p => withoutTag(p, tag))
}

/** Tag name → how many of these photos wear it. */
export function tagCounts(photos: readonly Photo[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const photo of photos) {
    for (const tag of tagsOf(photo))
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return counts
}
