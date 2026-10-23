/**
 * Drive the built app against `scripts/jev-mock.mjs` with Playwright: commit a
 * text label, let Jev choose its leading icon, and assert the store and the
 * wire. Screenshots and measurements go to /tmp/jev-tags-verify.
 * Run with `bun scripts/jev-e2e.mjs`.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { serve } from 'bun'
import { chromium } from 'playwright-core'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = process.env.JEV_SHOTS ?? '/tmp/jev-tags-verify'
const APP_PORT = Number(process.env.JEV_APP_PORT ?? 5199)
const MOCK_PORT = Number(process.env.JEV_MOCK_PORT ?? 4319)
const APP = `http://127.0.0.1:${APP_PORT}`
const MOCK = `http://127.0.0.1:${MOCK_PORT}`
const JEV_URL = `${MOCK}/v1/systemone`
const CHROMIUM = process.env.JEV_CHROMIUM ?? findChromium()

function findChromium() {
  const home = process.env.HOME
  const candidates = [
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  ]
  const found = candidates.find(path => existsSync(path))
  if (!found)
    throw new Error('no cached Chromium found; set JEV_CHROMIUM')
  return found
}

function start(command, args, env = {}) {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.output = ''
  child.stdout.on('data', (d) => {
    child.output += d
  })
  child.stderr.on('data', (d) => {
    child.output += d
  })
  return child
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = start(command, args, env)
    child.on('error', reject)
    child.on('exit', code => code === 0
      ? resolve(child.output)
      : reject(new Error(`${command} exited ${code}\n${child.output.slice(-4000)}`)))
  })
}

async function waitForHttp(url, ms = 60_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok)
        return
    }
    catch {}
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${url}`)
}

function check(ok, message) {
  if (!ok)
    throw new Error(`FAIL ${message}`)
}

function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`FAIL ${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`)
}

async function mockState() {
  return (await fetch(`${MOCK}/last`)).json()
}

async function waitForCall(n) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const last = await mockState()
    if (last && last.calls >= n)
      return last
    await sleep(100)
  }
  throw new Error(`timed out waiting for Jev call ${n}`)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

/**
 * Serve `dist` over plain HTTP. Vite's preview inherits the mkcert HTTPS
 * server, and an https page may not call the plain-http mock (mixed content),
 * so the check serves the build itself.
 */
function serveDist() {
  return serve({
    hostname: '127.0.0.1',
    port: APP_PORT,
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname)
      const target = path === '/' || path === '' ? '/index.html' : path
      const full = join(ROOT, 'dist', target)
      try {
        const ext = full.slice(full.lastIndexOf('.'))
        return new Response(readFileSync(full), { headers: { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' } })
      }
      catch {
        return new Response(readFileSync(join(ROOT, 'dist', 'index.html')), { headers: { 'Content-Type': TYPES['.html'] } })
      }
    },
  })
}

/** The label as the store holds it. */
async function storedLabel(page, id) {
  return page.evaluate((labelId) => {
    const state = window.__collage.store()
    const ws = state.workspaces.find(w => w.id === state.activeId)
    return ws?.labels?.find(label => label.id === labelId) ?? null
  }, id)
}

/** Add a label through the store, then commit text through the real editor. */
async function addAndType(page, x, y, text) {
  const id = await page.evaluate(([left, top]) => window.__collage.useStore.getState().addLabel(left, top), [x, y])
  await page.waitForSelector(`[data-label-id="${id}"]`)
  await page.dblclick(`[data-label-id="${id}"]`)
  await page.waitForSelector(`[data-label-id="${id}"] [contenteditable]`)
  await page.keyboard.type(text)
  // Escape blurs the editor, and blur is the commit.
  await page.keyboard.press('Escape')
  return id
}

async function waitForIcon(page, id, icon) {
  await page.waitForFunction(([labelId, wanted]) => {
    const state = window.__collage.store()
    const ws = state.workspaces.find(w => w.id === state.activeId)
    return ws?.labels?.find(label => label.id === labelId)?.icon === wanted
  }, [id, icon])
}

async function tryOllama(files) {
  try {
    const tags = await (await fetch('http://localhost:11434/api/tags')).json()
    const installed = (tags.models ?? []).map(model => model.name)
    if (!installed.some(name => name === 'qwen2.5vl:7b' || name.startsWith('qwen2.5vl:7b')))
      return `ollama is running but qwen2.5vl:7b is not installed (have: ${installed.join(', ') || 'none'})`
    const out = {}
    for (const [name, file] of Object.entries(files)) {
      const prompt = 'This is a screenshot of a collage board. A text label near the center should lead with a small cake icon before its Chinese text. Describe what you see. Report clipped text, overlapping controls, or an icon detached from its text. Stay under 100 words.'
      const image = readFileSync(file).toString('base64')
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'qwen2.5vl:7b', prompt, images: [image], stream: false, options: { temperature: 0 } }),
      })
      if (!res.ok)
        throw new Error(`ollama answered ${res.status}`)
      out[name] = (await res.json()).response
    }
    return out
  }
  catch (error) {
    return `ollama review unavailable: ${error.message}`
  }
}

mkdirSync(SHOTS, { recursive: true })

let mock
let app
let browser

try {
  console.log(`building with VITE_JEV_API_URL=${JEV_URL}`)
  await run('bunx', ['vite', 'build'], { VITE_JEV_API_URL: JEV_URL })

  mock = start('bun', ['scripts/jev-mock.mjs'], { JEV_MOCK_PORT: String(MOCK_PORT) })
  app = serveDist()
  await waitForHttp(`${MOCK}/last`)
  await waitForHttp(`${APP}/`)

  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', error => console.log(`page error: ${error.message}`))

  await page.goto(`${APP}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__collage?.useStore)

  // `/` is the board overview. Enter the active board through the hash router,
  // which swaps the view without reloading the document.
  const wsId = await page.evaluate(() => window.__collage.store().activeId)
  await page.evaluate((id) => {
    window.location.hash = `#/w/${id}`
  }, wsId)
  await page.waitForSelector('[data-pane-id]')

  const cakeId = await addAndType(page, 0.5, 0.5, '生日蛋糕')
  await waitForIcon(page, cakeId, 'cake')
  const first = await waitForCall(1)
  check(first.contentType?.startsWith('application/json'), `the request is JSON (${first.contentType})`)
  check(first.dangerZone === null, 'no image header rides the label request')
  check(first.model === 'jev-latest', `the request named jev-latest (${first.model})`)
  check(first.state === '生日蛋糕', `the label text is the state (${first.state})`)
  equal(first.questionIds, ['label_icon'], 'one Choice question')
  check(first.questionType === 'choice', `the question is a Choice (${first.questionType})`)
  equal(first.criteriaCount, 129, 'every catalog icon plus none is a criterion')
  check(first.hasNone, 'the none option is present')
  check(first.choice === 'cake', `the mock chose the cake icon (${first.choice})`)
  check((await storedLabel(page, cakeId))?.text === '生日蛋糕', 'the committed text stays')

  // A label that already has an icon keeps it: the pick never runs.
  const pinnedId = await page.evaluate(() => {
    const s = window.__collage.useStore.getState()
    const id = s.addLabel(0.3, 0.3)
    s.setLabel(id, { text: '旧标题', icon: 'pin' })
    return id
  })
  await page.waitForSelector(`[data-label-id="${pinnedId}"]`)
  await page.dblclick(`[data-label-id="${pinnedId}"]`)
  await page.waitForSelector(`[data-label-id="${pinnedId}"] [contenteditable]`)
  await page.keyboard.type('东京旅行')
  await page.keyboard.press('Escape')
  await sleep(600)
  check((await storedLabel(page, pinnedId))?.icon === 'pin', 'a user-chosen icon survives a text edit')
  check((await mockState()).calls === 1, 'an iconed label never reaches Jev')

  // A second text commits and picks a different icon from the same catalog.
  const travelId = await addAndType(page, 0.7, 0.7, '东京旅行')
  await waitForIcon(page, travelId, 'plane')
  const second = await waitForCall(2)
  check(second.state === '东京旅行', `the second state is its own text (${second.state})`)
  check(second.choice === 'plane', `the mock chose the plane icon (${second.choice})`)

  await page.setViewportSize({ width: 1280, height: 900 })
  const wideBox = await page.locator(`[data-label-id="${cakeId}"]`).boundingBox()
  await page.screenshot({ path: join(SHOTS, 'label-1280x900.png'), animations: 'disabled' })

  await page.setViewportSize({ width: 375, height: 812 })
  const phoneBox = await page.locator(`[data-label-id="${cakeId}"]`).boundingBox()
  await page.screenshot({ path: join(SHOTS, 'label-375x812.png'), animations: 'disabled' })

  check(wideBox && wideBox.width > 0 && wideBox.height > 0, `the cake label draws at 1280x900 (${JSON.stringify(wideBox)})`)
  check(phoneBox && phoneBox.width > 0 && phoneBox.height > 0, `the cake label draws at 375x812 (${JSON.stringify(phoneBox)})`)

  const metrics = {
    first,
    second,
    labels: {
      cake: await storedLabel(page, cakeId),
      pinned: await storedLabel(page, pinnedId),
      travel: await storedLabel(page, travelId),
    },
    wideBox,
    phoneBox,
  }
  writeFileSync(join(SHOTS, 'measurements.json'), `${JSON.stringify(metrics, null, 2)}\n`)

  const review = await tryOllama({
    '1280x900': join(SHOTS, 'label-1280x900.png'),
    '375x812': join(SHOTS, 'label-375x812.png'),
  })
  console.log('\nscreenshots:')
  console.log(`  ${join(SHOTS, 'label-1280x900.png')}`)
  console.log(`  ${join(SHOTS, 'label-375x812.png')}`)
  console.log('\nmeasurements:')
  console.log(JSON.stringify(metrics, null, 2))
  console.log('\nvision review:')
  console.log(typeof review === 'string' ? review : `1280x900: ${review['1280x900']}\n\n375x812: ${review['375x812']}`)
  console.log('\njev e2e: PASS')
}
finally {
  await browser?.close().catch(() => {})
  app?.stop(true)
  mock?.kill('SIGTERM')
}
