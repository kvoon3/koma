import process from 'node:process'
import { serve } from 'bun'

/**
 * A stand-in for the TypeSafe System One endpoint, for the browser check in
 * `scripts/jev-e2e.mjs`. It reads the JSON Choice request, answers with a
 * plausible icon from the criteria, and records the last call at `GET /last`.
 * `GET /mode?fail=1` makes the next calls fail.
 */
const port = Number(process.env.JEV_MOCK_PORT ?? 4319)
const MODEL = 'jev-1.14.0'

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

function isPath(pathname) {
  return pathname === '/v1/systemone'
}

/** A plausible id for the label text, limited to the options that were sent. */
function choose(state, criteria) {
  const text = String(state ?? '').toLocaleLowerCase()
  const wanted = [
    ['cake', ['生日', '蛋糕', 'cake', 'birthday']],
    ['plane', ['东京', '旅行', '飞机', 'travel', 'trip', 'tokyo']],
    ['star', ['星', 'star']],
  ]
  for (const [id, words] of wanted) {
    if (id in criteria && words.some(word => text.includes(word)))
      return id
  }
  return 'none' in criteria ? 'none' : Object.keys(criteria)[0] ?? 'none'
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
    const contentType = req.headers.get('content-type')
    const dangerZone = req.headers.get('typesafe-danger-zone-images')
    let document = null
    try {
      document = await req.json()
    }
    catch {}

    const question = document?.questions?.label_icon
    const criteria = question?.criteria ?? {}
    const choice = choose(document?.state, criteria)

    last = {
      calls,
      path: url.pathname,
      contentType,
      auth: req.headers.get('authorization'),
      dangerZone,
      model: document?.model ?? null,
      state: document?.state ?? null,
      questionType: question?.type ?? null,
      questionIds: Object.keys(document?.questions ?? {}),
      criteriaCount: Object.keys(criteria).length,
      hasNone: 'none' in criteria,
      choice,
    }

    if (fail) {
      last.status = 503
      return Response.json({ error: 'mock down' }, { status: 503, headers })
    }

    if (dangerZone !== null) {
      last.status = 400
      return Response.json({ error: 'an image header is not expected' }, { status: 400, headers })
    }

    if (!contentType?.startsWith('application/json')) {
      last.status = 415
      return Response.json({ error: 'application/json is required' }, { status: 415, headers })
    }

    if (question?.type !== 'choice' || Object.keys(criteria).length === 0) {
      last.status = 422
      return Response.json({ error: 'one Choice question is required' }, { status: 422, headers })
    }

    last.status = 200
    return Response.json({
      model: MODEL,
      answers: {
        label_icon: { type: 'choice', choice, confidence: choice === 'none' ? 0.4 : 0.93 },
      },
      usage: { input_tokens: 220, output_tokens: 3 },
    }, { headers })
  },
})

console.log(`jev mock listening on http://127.0.0.1:${server.port}`)
