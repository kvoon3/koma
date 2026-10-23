import process from 'node:process'
import { serve } from 'bun'

/**
 * A stand-in for the TypeSafe System One endpoint, for the browser check in
 * `scripts/jev-e2e.mjs`. It reads the `request` part, answers every question id
 * with a deterministic Noul probability, and records the last call at
 * `GET /last`. `GET /mode?fail=1` makes the next calls fail for the retry path.
 */
const port = Number(process.env.JEV_MOCK_PORT ?? 4319)
const MODEL = 'jev-1.14.0'

/** Deterministic probabilities with answers on both sides of 0.7. */
const NOUL = {
  person: 0.99,
  family: 0.12,
  cat: 0.88,
  dog: 0.03,
  pet: 0.07,
  food: 0.62,
  drink: 0.08,
  nature: 0.42,
  beach: 0.94,
  mountain: 0.06,
  city: 0.21,
  car: 0.04,
  plane: 0.02,
  art: 0.09,
  night: 0.11,
  snow: 0.01,
  celebration: 0.05,
}

let last = null
let fail = false
let calls = 0

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type, TypeSafe-Danger-Zone-Images',
  }
}

function isPath(pathname) {
  return pathname === '/classify' || pathname === '/v1/systemone'
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

    if (!isPath(url.pathname) || req.method !== 'POST')
      return Response.json({ error: 'not found' }, { status: 404, headers })

    calls++
    const dangerZone = req.headers.get('typesafe-danger-zone-images')
    let document = null
    let image = null
    try {
      const form = await req.formData()
      const requestPart = form.get('request')
      if (requestPart && typeof requestPart === 'object')
        document = JSON.parse(await requestPart.text())
      image = form.get('photo')
    }
    catch {}

    const questionIds = Object.keys(document?.questions ?? {})
    const answers = Object.fromEntries(questionIds.map(id => [id, {
      type: 'noul',
      noul: NOUL[id] ?? 0.05,
    }]))

    last = {
      calls,
      path: url.pathname,
      hasImage: image != null,
      bytes: image?.size ?? 0,
      type: image?.type ?? '',
      filename: image?.name ?? '',
      auth: req.headers.get('authorization'),
      dangerZone,
      model: document?.model ?? null,
      assetPart: document?.assets?.photo?.part ?? null,
      questionIds,
      answers,
    }

    if (fail) {
      last.status = 503
      return Response.json({ error: 'mock down' }, { status: 503, headers })
    }

    if (dangerZone?.toLowerCase() !== 'true') {
      last.status = 400
      return Response.json({ error: 'TypeSafe-Danger-Zone-Images is required' }, { status: 400, headers })
    }

    if (!document || questionIds.length === 0) {
      last.status = 422
      return Response.json({ error: 'the request part is required' }, { status: 422, headers })
    }

    if (!image) {
      last.status = 422
      return Response.json({ error: 'the photo part is required' }, { status: 422, headers })
    }

    last.status = 200
    return Response.json({
      model: MODEL,
      answers,
      usage: { input_tokens: 2003, output_tokens: questionIds.length },
    }, { headers })
  },
})

console.log(`jev mock listening on http://127.0.0.1:${server.port}`)
