/**
 * Browser evidence for the top bar's shared hover fill.
 *
 * Playwright-core and the cached Chromium are local tools, not dependencies, so
 * this runs by hand. It spawns the dev server unless KOMA_DEV_URL is set:
 *   bun scripts/check-bar-glide.mjs
 *   KOMA_DEV_URL=https://localhost:5289 bun scripts/check-bar-glide.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const OUT = process.env.KOMA_SHOTS ?? '/tmp/bar-glide-shots'
const BASE = process.env.KOMA_DEV_URL ?? 'https://localhost:5391'
const CHROMIUM = process.env.CHROMIUM_PATH ?? findChromium()
mkdirSync(OUT, { recursive: true })

function findChromium() {
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  const dirs = readdirSync(root)
    .filter(name => /^chromium(?:-headless_shell)?-\d+$/.test(name))
    .map(name => Number(name.split('-').at(-1)))
    .sort((a, b) => b - a)
  for (const num of dirs) {
    for (const dir of [`chromium-${num}`, `chromium_headless_shell-${num}`]) {
      for (const path of [
        join(root, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, dir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
      ]) {
        if (existsSync(path))
          return path
      }
    }
  }
  throw new Error('Set CHROMIUM_PATH: no cached Chromium under ms-playwright')
}

function assert(condition, message) {
  if (!condition)
    throw new Error(message)
}

const server = process.env.KOMA_DEV_URL
  ? null
  : spawn('bun', ['run', 'dev', '--', '--port', '5391', '--strictPort'], { stdio: 'ignore', detached: true })

async function gotoWithRetry(page) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 5000 })
      return
    }
    catch {
      await sleep(500)
    }
  }
  throw new Error(`dev server never answered at ${BASE}`)
}

/** The chip's border box, in viewport px. */
function chipBox(page, name) {
  return page.evaluate((label) => {
    const el = [...document.querySelectorAll('[data-bar-chip]')].find(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').includes(label))
    if (!el)
      return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height, bg: getComputedStyle(el).backgroundColor }
  }, name)
}

/** The hover box's painted box and whether it is visible. */
function boxState(page) {
  return page.evaluate(() => {
    const box = document.querySelector('[data-bar-highlight]')
    const r = box.getBoundingClientRect()
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      opacity: Number(getComputedStyle(box).opacity),
      bg: getComputedStyle(box).backgroundColor,
      animations: box.getAnimations().length,
    }
  })
}

function near(a, b, eps = 0.75) {
  return Math.abs(a - b) <= eps
}

function sameBox(a, b) {
  return near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height)
}

/** Record the box's left edge once per frame for `frames` frames. */
function startSampler(page, frames = 40) {
  return page.evaluate((count) => {
    const box = document.querySelector('[data-bar-highlight]')
    window.__barXs = []
    let n = 0
    const loop = () => {
      window.__barXs.push(box.getBoundingClientRect().left)
      if (++n < count)
        requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }, frames)
}

function readSamples(page) {
  return page.evaluate(() => window.__barXs)
}

const browser = await chromium.launch({ executablePath: CHROMIUM })
const results = {}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await gotoWithRetry(page)
  await page.waitForSelector('[data-bar-chip]')

  const chips = await page.locator('[data-bar-chip]').count()
  results.chips = chips
  assert(chips >= 7, `expected the bar's 7 chips, found ${chips}`)

  // Rest state: nothing painted, nothing marked.
  const rest = await boxState(page)
  assert(rest.opacity === 0, `the box painted at rest (opacity ${rest.opacity})`)

  // Hover one chip: the box sits exactly under it and the chip itself has no
  // fill of its own (the bar variant is transparent; the box is the surface).
  const photo = await page.locator('[data-bar-chip]', { hasText: 'Photo' }).first().hover()
  void photo
  await sleep(240)
  const photoChip = await chipBox(page, 'Photo')
  const photoBox = await boxState(page)
  results.photoChip = photoChip
  results.photoBox = photoBox
  assert(photoBox.opacity === 1, `the box did not show on hover (opacity ${photoBox.opacity})`)
  assert(sameBox(photoChip, photoBox), `box ${JSON.stringify(photoBox)} != Photo chip ${JSON.stringify(photoChip)}`)
  assert(photoBox.bg === 'rgb(245, 245, 245)', `the box is not the chip-hover surface: ${photoBox.bg}`)
  assert(photoChip.bg === 'rgba(0, 0, 0, 0)', `the hovered chip still paints its own fill: ${photoChip.bg}`)

  // Glide to the language chip across the actions cluster, sampling every frame.
  await startSampler(page)
  const lang = page.locator('[data-bar-chip][aria-label="Language"]')
  await lang.hover()
  await sleep(320)
  const samples = await readSamples(page)
  const langChip = await chipBox(page, 'Language')
  results.glide = { from: photoBox.left, samples, to: langChip.left }
  assert(samples.some(x => x > photoBox.left + 1 && x < langChip.left - 1), `no mid-flight sample between the chips: ${samples}`)
  await sleep(240)
  const langBox = await boxState(page)
  assert(sameBox(langChip, langBox), `box ${JSON.stringify(langBox)} != Language chip ${JSON.stringify(langChip)}`)
  results.langBox = langBox

  // Leaving the chips hides the box; the text shift stays with the chip.
  await page.mouse.move(640, 400)
  await sleep(200)
  assert((await boxState(page)).opacity === 0, 'the box stayed painted after the pointer left the bar')

  // The open menu's backdrop swallows pointerover: the window hit-test must
  // still drive the fill and the hand-over. Open Workspace, then hover Language.
  await page.locator('[data-bar-chip]', { hasText: 'Workspace' }).first().click()
  await page.waitForSelector('[role="menu"]')
  // The trigger fades its own fill in over --dur-fast; read after the fade.
  await sleep(240)
  const wsOpen = await chipBox(page, 'Workspace')
  results.openFill = wsOpen
  assert(wsOpen.bg === 'rgb(245, 245, 245)', `the open trigger lost its own fill: ${wsOpen.bg}`)
  const settingsChip = await page.locator('[data-bar-chip][aria-label*="Settings"]').first().boundingBox()
  assert(settingsChip, 'settings chip not found')
  await page.mouse.move(settingsChip.x + settingsChip.width / 2, settingsChip.y + settingsChip.height / 2)
  await sleep(240)
  const throughBox = await boxState(page)
  const settingsBoxM = await chipBox(page, 'Settings')
  results.backdrop = { box: throughBox, chip: settingsBoxM }
  assert(sameBox(settingsBoxM, throughBox), `backdrop hit-test did not place the box: ${JSON.stringify({ throughBox, settingsBoxM })}`)
  assert(await page.locator('[data-bar-chip][aria-label*="Settings"]').first().getAttribute('data-popup-open') != null, 'the settings panel did not hand over')
  // Close the handed-over panel before the screenshot pass. A click on the
  // stage dismisses the popover; keep Escape as the fallback and prove the bar
  // is closed before every shot, or a hovered chip would open the next menu.
  await page.mouse.click(640, 400)
  await sleep(200)
  if (await page.locator('[data-popup-open]').count() > 0) {
    await page.keyboard.press('Escape')
    await sleep(200)
  }
  assert(await page.locator('[data-popup-open]').count() === 0, 'a menu or popover stayed open before the screenshot pass')
  await page.mouse.move(640, 400)

  // Screenshots at the four sizes; hover Photo in each so the fill shows.
  for (const [w, h, name] of [[1280, 900, 'desktop'], [375, 812, 'phone'], [1280, 600, 'short'], [915, 412, 'landscape']]) {
    await page.setViewportSize({ width: w, height: h })
    await sleep(200)
    const target = page.locator('[data-bar-chip]', { hasText: 'Photo' }).first()
    await target.hover()
    await sleep(240)
    const chip = await chipBox(page, 'Photo')
    const box = await boxState(page)
    results[`shot-${name}`] = { chip, box, same: sameBox(chip, box) }
    await page.screenshot({ path: join(OUT, `${name}.png`) })
  }
  await context.close()

  // Reduced motion: the box snaps, no animation runs.
  const reduceContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  const reducePage = await reduceContext.newPage()
  await gotoWithRetry(reducePage)
  await reducePage.waitForSelector('[data-bar-chip]')
  await reducePage.locator('[data-bar-chip]', { hasText: 'Photo' }).first().hover()
  await sleep(100)
  await reducePage.locator('[data-bar-chip][aria-label="Language"]').hover()
  const reduced = await boxState(reducePage)
  const reducedChip = await chipBox(reducePage, 'Language')
  results.reduced = { box: reduced, chip: reducedChip }
  assert(sameBox(reducedChip, reduced), `reduced motion did not snap: ${JSON.stringify({ reduced, reducedChip })}`)
  assert(reduced.animations === 0, `reduced motion started ${reduced.animations} animation(s)`)
  await reduceContext.close()

  console.log(JSON.stringify(results, null, 2))
}
finally {
  await browser.close()
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    }
    catch {}
  }
}
