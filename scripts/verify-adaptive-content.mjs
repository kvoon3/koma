/**
 * Verify the board items' adaptive content: the empty-pane and empty-cell
 * hints answer the item's own size, not the viewport's (a big screen splits
 * just as small, so the contract is a container query). The label truncates
 * in the mid band and hides under 7rem, where the glyph carries the
 * affordance alone; the loading line truncates. Measurements to
 * /tmp/koma-adaptive-verify.
 *
 * Run: bun scripts/verify-adaptive-content.mjs  (serves dist; build first)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { serve } from 'bun'
import { chromium } from 'playwright-core'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = process.env.SHOTS ?? '/tmp/koma-adaptive-verify'
const APP_PORT = Number(process.env.APP_PORT ?? 5218)
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

function check(ok, message) {
  if (!ok)
    throw new Error(`FAIL ${message}`)
  console.log(`  ok: ${message}`)
}

/**
 * The hint probe, run in the page: finds the item by `pick` among `selector`,
 * and reads the hint's container width, its label's display/width (the last
 * span inside) and its glyph.
 */
function probeHint({ selector, pick }) {
  const items = [...document.querySelectorAll(selector)]
  const at = (pick === 'narrowest')
    ? items.reduce((a, b) => (b.getBoundingClientRect().width < a.getBoundingClientRect().width ? b : a))
    : items[0]
  if (!at)
    return null
  const spans = at.querySelectorAll('span')
  const label = spans[spans.length - 1]
  const glyph = at.querySelector('svg')
  const atRect = at.getBoundingClientRect()
  const vis = (el) => {
    if (!el)
      return null
    const r = el.getBoundingClientRect()
    return { display: getComputedStyle(el).display, w: +r.width.toFixed(1) }
  }
  return {
    containerW: +atRect.width.toFixed(1),
    itemW: +at.getBoundingClientRect().width.toFixed(1),
    label: vis(label),
    glyph: vis(glyph),
    overflows: label ? label.getBoundingClientRect().right > atRect.right + 0.5 : false,
  }
}

try {
  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', e => console.log(`page error: ${e.message}`))

  await page.goto(`${APP}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__collage?.useStore)
  await page.waitForSelector('[data-board]')
  await sleep(300)

  const gridAt = async (label, shot) => {
    const m = await page.evaluate(probeHint, { selector: '[data-cell-hint]', pick: 'first' })
    console.log(`\n== ${label} → cell ${m.containerW}px, label ${m.label ? `${m.label.display}@${m.label.w}px` : 'none'}`)
    if (shot)
      await page.screenshot({ path: join(SHOTS, shot), animations: 'disabled' })
    results.push({ label, ...m })
    return m
  }

  const paneAt = async (label, shot) => {
    const m = await page.evaluate(probeHint, { selector: '[data-pane-hint]', pick: 'narrowest' })
    console.log(`\n== ${label} → hint ${m.containerW}px, label ${m.label ? `${m.label.display}@${m.label.w}px` : 'none'}`)
    if (shot)
      await page.screenshot({ path: join(SHOTS, shot), animations: 'disabled' })
    results.push({ label, ...m })
    return m
  }

  // ---- Grid overview: the empty-cell hint across cell sizes. ----
  const wide = await gridAt('Grid 1280x900 (wide cells)', 'grid-wide.png')
  check(wide.label && wide.label.display !== 'none', 'wide cell: the label shows')

  await page.setViewportSize({ width: 375, height: 812 })
  await sleep(400)
  const narrow = await gridAt('Grid 375x812 (narrow cells)', 'grid-narrow.png')
  check(narrow.containerW < 112, `narrow cell is under the 7rem bound (${narrow.containerW}px)`)
  check(narrow.label && narrow.label.display === 'none', 'narrow cell: the label hides, the glyph carries')
  check(narrow.glyph && narrow.glyph.display !== 'none', 'narrow cell: the glyph shows')
  check(!narrow.overflows, 'narrow cell: nothing overflows the cell')

  // ---- The stage: the same hint on a pane, split small on a big screen. ----
  const wsId = await page.evaluate(() => window.__collage.store().activeId)
  await page.evaluate((id) => {
    window.location.hash = `#/w/${id}`
  }, wsId)
  await page.setViewportSize({ width: 1280, height: 900 })
  await sleep(400)
  await page.waitForSelector('[data-pane-id]')
  await sleep(300)

  const bigPane = await paneAt('Stage 1280x900, full pane', 'stage-full.png')
  check(bigPane.label && bigPane.label.display !== 'none', 'big pane: the label shows')

  await page.evaluate(() => {
    const s = window.__collage.useStore.getState()
    const ws = s.workspaces.find(w => w.id === s.activeId)
    s.split(ws.root.id, 'row')
  })
  await sleep(400)
  const halfPanes = await paneAt('Stage 1280x900, split once', 'stage-split.png')
  check(halfPanes.label && halfPanes.label.display !== 'none', 'half pane on a big screen: the label still shows (item-sized, not viewport-sized)')

  await page.setViewportSize({ width: 375, height: 812 })
  await sleep(400)
  const midPane = await paneAt('Stage 375x812, split once', 'stage-small.png')
  check(midPane.label && midPane.label.display !== 'none', `164px pane: the label shows and fits (${midPane.label ? midPane.label.w : 0}px in ${midPane.containerW}px)`)
  check(!midPane.overflows, '164px pane: nothing overflows')

  // Split the narrowest pane again: under 7rem, the label must hide.
  await page.evaluate(() => {
    const s = window.__collage.useStore.getState()
    const panes = [...document.querySelectorAll('[data-pane-id]')]
    const pane = panes.reduce((a, b) => (b.getBoundingClientRect().width < a.getBoundingClientRect().width ? b : a))
    s.split(pane.getAttribute('data-pane-id'), 'row')
  })
  await sleep(400)
  const smallPanes = await paneAt('Stage 375x812, split twice', 'stage-tiny.png')
  check(smallPanes.containerW < 112, `small pane is under the 7rem bound (${smallPanes.containerW}px)`)
  check(smallPanes.label && smallPanes.label.display === 'none', 'small pane: the label hides')
  check(smallPanes.glyph && smallPanes.glyph.display !== 'none', 'small pane: the glyph shows')
  check(!smallPanes.overflows, 'small pane: nothing overflows the pane')

  writeFileSync(join(SHOTS, 'measurements.json'), `${JSON.stringify(results, null, 2)}\n`)
  console.log(`\nmeasurements: ${join(SHOTS, 'measurements.json')}`)
  console.log('\nadaptive content verify: PASS')
}
finally {
  await browser?.close().catch(() => {})
  app?.stop(true)
}
