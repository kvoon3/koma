/**
 * Browser evidence for the texture popup's open state across a deselect
 * (issue #76): the popover must not come back open after a stage-margin
 * press hides the tool and a pane is re-focused, and the open popup must
 * still anchor above the dock sheet on a short window.
 *
 * Playwright-core and the cached Chromium are local tools, not dependencies,
 * so this runs by hand against the dev server:
 *   bun run dev -- --port 5199 --strictPort
 *   bun scripts/check-filter-popup.mjs
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const BASE = process.env.POPUP_BASE ?? 'https://localhost:5199'
const OUT = process.env.POPUP_SHOTS ?? '/tmp/filter-popup-shots'
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

async function seedOnePhoto(page) {
  await page.waitForFunction(() => window.__collage?.store)
  await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 900
    c.height = 700
    const g = c.getContext('2d')
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `hsl(${i * 9},70%,${30 + (i % 5) * 10}%)`
      g.fillRect(i * 24, 0, 24, 700)
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))
    window.__collage.store().addPhotos([new File([blob], 'seed.jpg', { type: 'image/jpeg' })], true)
  })
}

async function stageMarginPoint(page) {
  return await page.evaluate(() => {
    const wrap = document.querySelector('.stage-checker')
    if (!wrap)
      return null
    const w = wrap.getBoundingClientRect()
    const excluded = el => el.closest('[data-pane-id], [data-board-sticker], [data-label-id], button, [role="button"], [role="slider"], [role="menu"], [data-dock-mode]')
    for (let y = w.top + 10; y < w.bottom - 10; y += 24) {
      for (let x = w.left + 10; x < w.right - 10; x += 24) {
        const el = document.elementFromPoint(x, y)
        if (el && wrap.contains(el) && !excluded(el))
          return { x, y }
      }
    }
    return null
  })
}

async function openPalette(page) {
  await page.locator('img').first().waitFor({ state: 'visible', timeout: 15000 })
  await sleep(400)
  const img = page.locator('img').first()
  const b = await img.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  const trigger = page.locator('button[data-dock-filter]')
  await trigger.waitFor({ state: 'visible', timeout: 10000 })
  await trigger.click()
  await page.locator('[data-filter-body]').waitFor({ timeout: 5000 })
}

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })

{
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })).newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await seedOnePhoto(page)
  await openPalette(page)
  await page.click('button[data-filter-id="bayerColor"]')
  await sleep(300)
  assert(await page.locator('[data-filter-strip]').count() === 1, 'the Dither Color strip should show with the popup open')

  const margin = await stageMarginPoint(page)
  assert(margin, 'a stage-margin point should exist at 1280x900')
  await page.mouse.click(margin.x, margin.y)
  await sleep(500)
  assert(await page.locator('button[data-dock-filter]').count() === 0, 'the stage press should deselect and hide the tool')
  assert(await page.locator('[data-filter-body]').count() === 0, 'the popup should be gone with the tool hidden')

  const b = await page.locator('img').first().boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  const trigger = page.locator('button[data-dock-filter]')
  await trigger.waitFor({ state: 'visible', timeout: 10000 })
  await sleep(500)
  assert(await trigger.getAttribute('aria-expanded') !== 'true', 'the trigger must read collapsed after refocus (issue #76)')
  assert(await page.locator('[data-filter-body]').count() === 0, 'the popup must stay closed after refocus (issue #76)')

  await trigger.click()
  await page.locator('[data-filter-body]').waitFor({ timeout: 5000 })
  await page.keyboard.press('Escape')
  await sleep(300)
  assert(await page.locator('[data-filter-body]').count() === 0, 'Escape should still close the popup')
  await page.screenshot({ path: `${OUT}/after-1280x900.png` })
  await page.close()
}

{
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 375, height: 812 } })).newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await seedOnePhoto(page)
  await openPalette(page)
  await sleep(500)
  const geo = await page.evaluate(() => {
    const body = document.querySelector('[data-filter-body]')
    const sheet = document.querySelector('[data-dock-mode]')
    if (!body || !sheet)
      return null
    const p = body.getBoundingClientRect()
    const s = sheet.getBoundingClientRect()
    return { popupBottom: p.bottom, sheetTop: s.top, viewportH: window.innerHeight, scroll: body.parentElement.scrollTop }
  })
  assert(geo, 'the popup and the dock sheet should be measurable at 375x812')
  assert(geo.popupBottom <= geo.sheetTop + 1, `the popup bottom (${geo.popupBottom}) should sit above the sheet top (${geo.sheetTop}) at 375x812`)
  assert(geo.popupBottom <= geo.viewportH, 'the popup should fit the window at 375x812')
  await page.screenshot({ path: `${OUT}/after-375x812.png` })
  await page.close()
}

await browser.close()
console.log('filter popup check passed')
