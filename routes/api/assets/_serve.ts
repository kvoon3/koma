/**
 * The one serve response for a stored asset. Uploaded bytes can contain HTML or
 * scripts, so every content type gets `nosniff` and `attachment`: the URL
 * downloads when opened directly, while `<img>` and `<video>` still render it
 * (see void's storage guide). The object's own HTTP metadata supplies the
 * content type the browser uses to decode it.
 */
export interface ServedObject {
  body: ReadableStream
  httpEtag: string
  size: number
  writeHttpMetadata: (headers: Headers) => void
}

export function serveAsset(object: ServedObject): Response {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/octet-stream')
  headers.set('etag', object.httpEtag)
  headers.set('content-length', String(object.size))
  // A user's own bytes: never a shared cache's to keep.
  headers.set('cache-control', 'private, no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Disposition', 'attachment')
  return new Response(object.body, { headers })
}
