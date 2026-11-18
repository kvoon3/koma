/**
 * The wire shapes of the cloud routes, imported by the browser, the server
 * check and the client route declaration. No runtime code and no imports, so
 * every program can take the types without dragging a layer in.
 */
export interface CloudProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface CloudProjectDetail extends CloudProjectSummary {
  userId: string
  document: string
}

/**
 * One row from `/api/assets`. `kind` stays a plain string on the wire because
 * the column is text; `lib/cloudAsset` narrows it before it reaches the photo
 * library. `meta` is the stored `SessionPhotoRecord` minus its file bytes.
 */
export interface CloudAssetSummary {
  id: string
  kind: string
  name: string
  trueW: number
  trueH: number
  meta: string | null
  createdAt: string
}
