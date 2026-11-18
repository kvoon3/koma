/**
 * Where an uploaded asset lives in R2, derived on the server from the signed-in
 * user and the asset id. The client sends an id (its own photo id), never a
 * key: a key built from client input would let one account address another's
 * object. The derivation is pure so the route and its tests share one answer.
 *
 * Keys stay flat inside the user's prefix: `assets/{userId}/{assetId}`, with no
 * nested folders and no part that can contain a separator. An id is also the
 * `assets` row's primary key, so the same path is the one place an object can
 * be, and the serve route never has to store or trust a second location.
 */

/** The per-file upload cap, shown in the too-large error and enforced by the route. */
export const ASSET_MAX_MB = 50

/** Ids this app generates: timestamp/random photo ids and Better Auth user ids. */
const PART = /^[\w-]{1,128}$/

/** True when a value can be one path part without changing the key's shape. */
export function isAssetId(value: string): boolean {
  return PART.test(value)
}

/** The object key for one asset, or null when either part is not a safe id. */
export function assetStorageKey(userId: string, assetId: string): string | null {
  if (!isAssetId(userId) || !isAssetId(assetId))
    return null
  return `assets/${userId}/${assetId}`
}
