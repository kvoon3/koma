/**
 * The naming rules library labels share: a sticker folder (one name per
 * sticker) and a photo tag (many per photo) are both short hand-typed labels
 * from the same chip bar, so they clean, cap and compare the same way. The
 * membership rules differ and stay with their own modules (`stickerLibrary`,
 * `photoTags`); this is only what a name is.
 */

/** The cap keeps a chip readable on a phone. */
export const MAX_NAME_LEN = 24

/** Trim, collapse inner runs of space, cap the length (and re-trim the cut). */
export function cleanEntryName(raw: string, max: number = MAX_NAME_LEN): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, max).trim()
}

/** Names compare case-insensitively: "Faces" and "faces" would be one folder in practice. */
export function sameEntryName(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase()
}
