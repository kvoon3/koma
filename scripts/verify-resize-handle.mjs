/**
 * Verify the stage fit keeps the canvas aspect handle clickable. The fit box
 * ends at the tools sheet's top edge (the sheet is a fixed overlay), so a
 * height-limited board no longer seats its bottom-right corner, and the resize
 * handle straddling it, under the sheet's glass. Measurements and screenshots
 * go to /tmp/koma-resize-verify.
 *
 * Run: bun scripts/verify-resize-handle.mjs  (serves dist; build first)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { serve } from 'bun'
import { chromium } from 'playwright-core'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = process.env.SHOTS ?? '/tmp/koma-resize-verify'
const APP_PORT = Number(process.env.APP_PORT ?? 5214)
const APP = `http://127.0.0.1:${APP_PORT}`
const CHROMIUM = process.env.CHROMIUM ?? findChromium()

function findChromium() {
  const home = process.env.HOME
  const candidates = [
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  ]
  const found = candidates.find(path => existsSync(path))
  if (!found)
    throw new Error('no cached Chromium found; set CHROMIUM')
  return found
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

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

mkdirSync(SHOTS, { recursive: true })
const app = serveDist()
let browser
const results = []

/** Measure the geometry that decides whether the corner handle is clickable. */
async function measure(page, label, shot) {
  const m = await page.evaluate(() => {
    const handle = document.querySelector('[data-canvas-resize-handle]')
    const canvas = document.querySelector('[data-canvas-view]')
    const sheet = document.querySelector('[data-dock-mode]')
    const vw = window.innerWidth
    const vh = window.innerHeight
    const r = (el) => {
      if (!el)
        return null
      const b = el.getBoundingClientRect()
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) }
    }
    const hr = handle?.getBoundingClientRect()
    // Hit-test the handle's centre and its visible top-left quarter, the way a
    // pointer would land on it.
    const hit = (x, y) => {
      const el = document.elementFromPoint(x, y)
      if (!el)
        return 'nothing'
      if (el.closest('[data-canvas-resize-handle]'))
        return 'handle'
      if (el.closest('[data-dock-mode]'))
        return 'dock'
      return `${el.tagName}.${el.className?.toString().slice(0, 40) ?? ''}`
    }
    const s = window.__collage.store()
    const ws = s.workspaces.find(w => w.id === s.activeId)
    return {
      viewport: { vw, vh },
      canvasFill: ws?.canvasFill,
      canvasRatio: ws?.canvasRatio,
      canvas: r(canvas),
      handle: r(handle),
      sheet: r(sheet),
      hitAtCentre: hr ? hit(hr.x + hr.width / 2, hr.y + hr.height / 2) : null,
      hitAtTopLeft: hr ? hit(hr.x + 3, hr.y + 3) : null,
      handleVisibleH: hr ? +Math.max(0, Math.min(hr.bottom, vh) - Math.max(hr.y, 0)).toFixed(1) : 0,
    }
  })
  const clickable = m.hitAtCentre === 'handle'
  const clearsSheet = m.sheet == null || m.handle == null || m.handle.bottom <= m.sheet.y + 0.5
  console.log(`\n== ${label} (fill=${m.canvasFill}, ratio=${m.canvasRatio}) → ${clickable ? 'CLICKABLE' : 'NOT CLICKABLE'}${clickable && !clearsSheet ? ' (but under the sheet band)' : ''}`)
  console.log(JSON.stringify({ handle: m.handle, canvas: m.canvas, sheet: m.sheet && { top: m.sheet.y }, hit: m.hitAtCentre }, null, 2))
  if (shot)
    await page.screenshot({ path: join(SHOTS, shot), animations: 'disabled' })
  results.push({ label, ...m, clickable, clearsSheet })
  return m
}

function check(ok, message) {
  if (!ok)
    throw new Error(`FAIL ${message}`)
  console.log(`  ok: ${message}`)
}

try {
  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', e => console.log(`page error: ${e.message}`))

  await page.goto(`${APP}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__collage?.useStore)
  const wsId = await page.evaluate(() => window.__collage.store().activeId)
  await page.evaluate((id) => {
    window.location.hash = `#/w/${id}`
  }, wsId)
  await page.waitForSelector('[data-canvas-resize-handle]')
  await sleep(300)

  // PC, the plain fit: the handle must be on top and clear of the sheet.
  const fit = await measure(page, 'PC 1280x900, fill=1 (fit)', 'pc-fit.png')
  check(fit.hitAtCentre === 'handle', 'PC fit: the handle centre hits the handle, not the dock')
  check(fit.handle.bottom <= fit.sheet.y, `PC fit: the handle clears the sheet (${fit.handle.bottom} <= ${fit.sheet.y})`)
  check(fit.canvas.bottom <= fit.sheet.y, `PC fit: the canvas bottom stays above the sheet (${fit.canvas.bottom} <= ${fit.sheet.y})`)

  // A portrait canvas (height-limited on PC): the other shape that used to hide.
  await page.evaluate(() => window.__collage.useStore.getState().setCanvasSize(0.8, 1))
  await sleep(250)
  const tall = await measure(page, 'PC 1280x900, ratio 0.8 (portrait fit)', 'pc-portrait.png')
  check(tall.hitAtCentre === 'handle', 'PC portrait fit: the handle centre hits the handle')
  await page.evaluate(() => window.__collage.useStore.getState().setCanvasSize(1.5, 1))
  await sleep(250)

  // Scaled past the fit the corner deliberately leaves the stage (the rail
  // refits it); record where it goes, no assertion.
  await page.evaluate(() => window.__collage.useStore.getState().setCanvasFill(1.5))
  await sleep(250)
  await measure(page, 'PC 1280x900, fill=1.5 (past the fit, by design off-stage)', 'pc-fill-1_5.png')

  // A drag of the handle still lands where the render draws: drag the corner
  // inward and check the committed ratio matches the dragged direction.
  await page.evaluate(() => window.__collage.useStore.getState().setCanvasFill(1))
  await sleep(250)
  const h = await page.locator('[data-canvas-resize-handle]').boundingBox()
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x - 150, h.y - 90, { steps: 12 })
  await page.mouse.up()
  await sleep(250)
  const dragged = await measure(page, 'PC 1280x900, after a corner drag inward', 'pc-dragged.png')
  check(dragged.canvasRatio != null && Math.abs(dragged.canvasRatio - fit.canvasRatio) > 0.01, `a corner drag still reshapes (ratio ${fit.canvasRatio} → ${dragged.canvasRatio})`)
  check(dragged.hitAtCentre === 'handle', 'after the drag the handle is still clickable')

  // The phone keeps its fit: a width-limited board must not shrink.
  await page.evaluate(() => window.__collage.useStore.getState().setCanvasSize(1.5, 1))
  await page.setViewportSize({ width: 375, height: 812 })
  await sleep(400)
  const phone = await measure(page, 'Phone 375x812, fill=1 (fit)', 'phone-fit.png')
  check(phone.hitAtCentre === 'handle', 'phone fit: the handle centre hits the handle')
  check(Math.abs(phone.canvas.w - 327) < 2 && Math.abs(phone.canvas.h - 218) < 2, `phone fit geometry is unchanged (want ~327x218, got ${phone.canvas.w}x${phone.canvas.h})`)

  // Geometry changed, so the AGENTS.md viewport set: 1280x600 and 915x412.
  await page.evaluate(() => window.__collage.useStore.getState().setCanvasFill(1))
  await page.setViewportSize({ width: 1280, height: 600 })
  await sleep(400)
  const short = await measure(page, 'PC 1280x600, fill=1 (fit)', 'pc-1280x600.png')
  check(short.hitAtCentre === 'handle', '1280x600 fit: the handle stays clickable')
  await page.setViewportSize({ width: 915, height: 412 })
  await sleep(400)
  const squat = await measure(page, 'PC 915x412, fill=1 (fit)', 'pc-915x412.png')
  check(squat.hitAtCentre === 'handle', '915x412 fit: the handle stays clickable')

  writeFileSync(join(SHOTS, 'measurements.json'), `${JSON.stringify(results, null, 2)}\n`)
  console.log(`\nmeasurements: ${join(SHOTS, 'measurements.json')}`)
  console.log('\nresize-handle verify: PASS')
}
finally {
  await browser?.close().catch(() => {})
  app?.stop(true)
}
