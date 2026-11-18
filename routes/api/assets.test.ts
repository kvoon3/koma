import { describe, expect, test } from 'bun:test'
import { serveAsset } from './assets/_serve'

const TYPES = [
  'image/jpeg',
  'image/png',
  'text/html',
  'application/octet-stream',
  undefined,
]

function storedObject(contentType: string | undefined) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    }),
    httpEtag: '"etag-1"',
    size: 7,
    writeHttpMetadata(headers: Headers) {
      if (contentType)
        headers.set('content-type', contentType)
    },
  }
}

describe('serveAsset', () => {
  test('every content type is a download that cannot be sniffed', () => {
    for (const contentType of TYPES) {
      const response = serveAsset(storedObject(contentType))
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Content-Disposition')).toBe('attachment')
      expect(response.headers.get('etag')).toBe('"etag-1"')
      expect(response.headers.get('content-length')).toBe('7')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('content-type')).toBe(contentType ?? 'application/octet-stream')
    }
  })
})
