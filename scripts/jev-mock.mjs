import process from 'node:process'
import { serve } from 'bun'

/**
 * A tiny stand-in for the Jev endpoint, for the browser check in
 * `scripts/jev-e2e.mjs`. It records the last request at `GET /last`, so the
 * check can prove the image actually crossed the wire, and `GET /mode?fail=1`
 * makes the next calls fail for the retry path.
 *
 * Assumed contract (provisional): POST multipart/form-data with `image`,
 * answer `{ "labels": string[] }`.
 */
const port = Number(process.env.JEV_MOCK_PORT ?? 4319)
const labels = ['Person', 'Beach', 'Food', 'Cat', 'Unknown']

let last = null
let fail = false
let calls = 0

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
  }
}

const server = serve({
  hostname: '127.0.0.1',
  port,
  async fetch(req) {
    const url = new URL(req.url)
    const headers = cors()

    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers })

    if (url.pathname === '/last')
      return Response.json(last, { headers })

    if (url.pathname === '/mode') {
      fail = url.searchParams.get('fail') === '1'
      return Response.json({ fail }, { headers })
    }

    if (url.pathname !== '/classify' || req.method !== 'POST')
      return Response.json({ error: 'not found' }, { status: 404, headers })

    calls++
    let image = null
    try {
      const form = await req.formData()
      const part = form.get('image')
      if (part && typeof part === 'object' && typeof part.size === 'number')
        image = part
    }
    catch {}

    last = {
      calls,
      hasImage: image != null,
      bytes: image?.size ?? 0,
      type: image?.type ?? '',
      filename: image?.name ?? '',
      auth: req.headers.get('authorization'),
    }

    if (fail) {
      last.status = 503
      return Response.json({ error: 'mock down' }, { status: 503, headers })
    }

    if (!image) {
      last.status = 422
      return Response.json({ error: 'the image field is required' }, { status: 422, headers })
    }

    last.status = 200
    return Response.json({ labels }, { headers })
  },
})

console.log(`jev mock listening on http://127.0.0.1:${server.port}`)
