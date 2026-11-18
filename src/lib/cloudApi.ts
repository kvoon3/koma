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
