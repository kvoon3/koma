/**
 * Drive the built app against `scripts/jev-mock.mjs` with Playwright, then
 * write the screenshots and measurements to /tmp/jev-tags-verify.
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

/** The taxonomy the wire must carry, one Noul question per icon id. */
const TAXONOMY_IDS = [
  'person',
  'family',
  'cat',
  'dog',
  'pet',
  'food',
  'drink',
  'nature',
  'beach',
  'mountain',
  'city',
  'car',
  'plane',
  'art',
  'night',
  'snow',
  'celebration',
]
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

async function setMockFail(fail) {
  await fetch(`${MOCK}/mode?fail=${fail ? 1 : 0}`)
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

async function seedPhoto(page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#3b82f6'
    ctx.fillRect(0, 0, 320, 240)
    ctx.fillStyle = '#fde68a'
    ctx.fillRect(20, 20, 80, 60)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const file = new File([blob], 'harbour.png', { type: 'image/png' })
    window.__collage.useStore.setState({
      photos: [{ id: 'jev-photo', name: 'harbour.png', file, trueW: 320, trueH: 240 }],
      photoTags: [],
    })
  })
}

async function clearPhotoTags(page) {
  await page.evaluate(() => {
    const store = window.__collage.useStore
    const state = window.__collage.store()
    store.setState({
      photos: state.photos.map(p => (p.id === 'jev-photo' ? { ...p, tags: undefined } : p)),
      photoTags: [],
    })
  })
}

async function storedTags(page) {
  return page.evaluate(() => {
    const state = window.__collage.store()
    const photo = state.photos.find(p => p.id === 'jev-photo')
    return { tags: photo?.tags ?? [], list: state.photoTags }
  })
}

async function renderedLabels(page) {
  return page.$$eval('[data-jev-label]', elements => elements.map(element => ({
    label: element.getAttribute('data-jev-label'),
    icon: element.querySelector('[data-tag-icon]')?.getAttribute('data-tag-icon'),
    pressed: element.getAttribute('aria-pressed'),
  })))
}

async function classify(page) {
  await page.click('[data-photo-classify]')
  await page.waitForFunction(() => document.querySelectorAll('[data-jev-label]').length === 3)
}

async function measurePanel(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const inside = (r, outer) => r.left >= outer.left - 0.5 && r.top >= outer.top - 0.5
      && r.right <= outer.right + 0.5 && r.bottom <= outer.bottom + 0.5
    const dialog = document.querySelector('[data-photo-detail]')
    const dialogRect = rect(dialog)
    const labels = [...document.querySelectorAll('[data-jev-label]')].map((element) => {
      const text = element.querySelector('span')
      return {
        label: element.getAttribute('data-jev-label'),
        rect: rect(element),
        insideDialog: inside(element.getBoundingClientRect(), dialogRect),
        textOverflow: text ? text.scrollWidth > text.clientWidth + 1 : null,
      }
    })
    const confirm = document.querySelector('[data-jev-confirm]')
    const confirmRect = rect(confirm)
    const scroller = document.querySelector('[data-photo-detail] .overflow-y-auto')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dialog: dialogRect,
      labels,
      allLabelsInsideDialog: labels.every(item => item.insideDialog),
      allLabelsInsideViewport: labels.every(item => item.rect.right <= innerWidth + 0.5 && item.rect.bottom <= innerHeight + 0.5),
      confirm: confirmRect,
      confirmInsideDialog: inside(confirm.getBoundingClientRect(), dialogRect),
      confirmInsideViewport: confirmRect.right <= innerWidth + 0.5 && confirmRect.bottom <= innerHeight + 0.5,
      scroller: scroller ? { clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight } : null,
    }
  })
}

async function reviewWithOllama(file, viewport) {
  const prompt = `This is a screenshot of a photo detail dialog at ${viewport}. The Tags section should show a Suggested tags row of checkable chips, each chip carrying a small icon, with selected chips marked. Describe what you see. Report any clipped text, any overlapping controls, and any control that falls outside the dialog. Be specific and stay under 120 words.`
  const image = readFileSync(file).toString('base64')
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen2.5vl:7b', prompt, images: [image], stream: false, options: { temperature: 0 } }),
  })
  if (!res.ok)
    throw new Error(`ollama answered ${res.status}`)
  const data = await res.json()
  return data.response
}

async function tryOllama() {
  try {
    const tags = await (await fetch('http://localhost:11434/api/tags')).json()
    const installed = (tags.models ?? []).map(model => model.name)
    if (!installed.some(name => name === 'qwen2.5vl:7b' || name.startsWith('qwen2.5vl:7b')))
      return `ollama is running but qwen2.5vl:7b is not installed (have: ${installed.join(', ') || 'none'})`
    const wide = await reviewWithOllama(join(SHOTS, 'confirm-1280x900.png'), '1280x900')
    const phone = await reviewWithOllama(join(SHOTS, 'confirm-375x812.png'), '375x812')
    return { wide, phone }
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

  await page.goto(`${APP}/#/library`, { waitUntil: 'load' })
  await page.waitForSelector('[data-library]')
  await seedPhoto(page)
  await page.waitForSelector('[data-photo-open]')
  await page.click('[data-photo-open]')
  await page.waitForSelector('[data-photo-detail]')
  await page.waitForSelector('[data-photo-classify]:not([disabled])')

  await classify(page)
  const first = await waitForCall(1)
  check(first.hasImage, 'the photo part reached Jev')
  check(first.bytes > 0, `the photo had bytes (${first.bytes})`)
  check(first.type === 'image/jpeg', `the prepared image is a JPEG (${first.type})`)
  check(first.dangerZone === 'true', 'the image header reached Jev')
  check(first.auth === null, 'an unset key sends no Authorization header')
  check(first.model === 'jev-latest', `the request named jev-latest (${first.model})`)
  check(first.assetPart === 'photo', `the asset points at the photo part (${first.assetPart})`)
  equal(first.questionIds, TAXONOMY_IDS, 'every taxonomy category is one Noul question')

  const labels = await renderedLabels(page)
  equal(labels.map(item => item.label), ['Person', 'Beach', 'Cat'], 'only labels above the threshold render')
  equal(labels.map(item => item.icon), ['person', 'beach', 'cat'], 'each label wears the icon its name earns')
  check(labels.every(item => item.pressed === 'true'), 'returned labels start checked')
  check((await page.locator('[data-jev-label="Food"]').count()) === 0, 'a label below 0.7 stays hidden')

  const wideBox = await page.locator('[data-photo-detail]').boundingBox()
  check(wideBox && wideBox.x >= 0 && wideBox.y >= 0 && wideBox.x + wideBox.width <= 1280 && wideBox.y + wideBox.height <= 900, `dialog fits 1280x900 (${JSON.stringify(wideBox)})`)
  const wideMeasure = await measurePanel(page)
  check(wideMeasure.allLabelsInsideDialog && wideMeasure.allLabelsInsideViewport, `every label chip is fully drawn at 1280x900 (${JSON.stringify(wideMeasure.labels)})`)
  check(wideMeasure.confirmInsideDialog && wideMeasure.confirmInsideViewport, `the confirm control is fully drawn at 1280x900 (${JSON.stringify(wideMeasure.confirm)})`)
  await page.screenshot({ path: join(SHOTS, 'confirm-1280x900.png'), animations: 'disabled' })

  await page.click('[data-jev-label="Cat"]')
  await page.click('[data-jev-confirm]')
  await page.waitForSelector('[data-jev-labels]', { state: 'detached' })
  equal(await storedTags(page), { tags: ['Person', 'Beach'], list: ['Person', 'Beach'] }, 'only checked labels attach through tagPhoto')
  const chipIcons = await page.$$eval('[data-photo-detail-tag]', elements => elements.map(element => ({
    tag: element.getAttribute('data-photo-detail-tag'),
    icon: element.querySelector('[data-tag-icon]')?.getAttribute('data-tag-icon'),
  })))
  equal(chipIcons, [
    { tag: 'Person', icon: 'person' },
    { tag: 'Beach', icon: 'beach' },
  ], 'photo detail chips wear the same icons')

  await clearPhotoTags(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await setMockFail(true)
  await page.click('[data-photo-classify]')
  await page.waitForSelector('[data-jev-error="http"]')
  const errorText = (await page.locator('[data-jev-error] p').textContent()).trim()
  check(errorText.length > 0, 'a failed classify shows a readable message')
  check(await page.isVisible('[data-jev-retry]'), 'the failed state offers a retry')
  await page.click('[data-jev-retry]')
  await waitForCall(3)
  await page.waitForSelector('[data-jev-error="http"]')

  await setMockFail(false)
  await page.click('[data-jev-retry]')
  await page.waitForFunction(() => document.querySelectorAll('[data-jev-label]').length === 3)
  const phoneBox = await page.locator('[data-photo-detail]').boundingBox()
  check(phoneBox && phoneBox.x >= 0 && phoneBox.y >= 0 && phoneBox.x + phoneBox.width <= 375 && phoneBox.y + phoneBox.height <= 812, `dialog fits 375x812 (${JSON.stringify(phoneBox)})`)
  check(await page.isVisible('[data-jev-confirm]'), 'the confirm control is visible at phone width')
  const phoneMeasure = await measurePanel(page)
  check(phoneMeasure.allLabelsInsideDialog && phoneMeasure.allLabelsInsideViewport, `every label chip is fully drawn at 375x812 (${JSON.stringify(phoneMeasure.labels)})`)
  check(phoneMeasure.confirmInsideDialog && phoneMeasure.confirmInsideViewport, `the confirm control is fully drawn at 375x812 (${JSON.stringify(phoneMeasure.confirm)})`)
  await page.screenshot({ path: join(SHOTS, 'confirm-375x812.png'), animations: 'disabled' })

  await page.click('[data-jev-label="Person"]')
  await page.click('[data-jev-confirm]')
  await page.waitForSelector('[data-jev-labels]', { state: 'detached' })
  equal(await storedTags(page), { tags: ['Beach', 'Cat'], list: ['Beach', 'Cat'] }, 'the phone pass also adds only checked labels')

  const metrics = { wideBox, phoneBox, wideMeasure, phoneMeasure, errorText, labels, chipIcons }
  writeFileSync(join(SHOTS, 'measurements.json'), `${JSON.stringify(metrics, null, 2)}\n`)

  const review = await tryOllama()
  console.log('\nscreenshots:')
  console.log(`  ${join(SHOTS, 'confirm-1280x900.png')}`)
  console.log(`  ${join(SHOTS, 'confirm-375x812.png')}`)
  console.log('\nmeasurements:')
  console.log(JSON.stringify(metrics, null, 2))
  console.log('\nvision review:')
  console.log(typeof review === 'string' ? review : `1280x900: ${review.wide}\n\n375x812: ${review.phone}`)
  console.log('\njev e2e: PASS')
}
finally {
  await browser?.close().catch(() => {})
  app?.stop(true)
  mock?.kill('SIGTERM')
}
