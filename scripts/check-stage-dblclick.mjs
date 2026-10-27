// Measures the Stage onDoubleClick portal guard: a double-click inside
// portaled chrome (the tools dock, rendered outside .stage-checker) must not
// reset the zoomed view, while a double-click on the stage air still fits.
import { existsSync } from 'node:fs'
import process from 'node:process'
import { chromium } from 'playwright-core'

function findChromium() {
  const home = process.env.HOME
  const candidates = [
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  ]
  const found = candidates.find(path => existsSync(path))
  if (!found)
    throw new Error('no cached Chromium found; set JEV_CHROMIUM')
  return found
}

const CHROMIUM = process.env.JEV_CHROMIUM ?? findChromium()
const APP = process.env.KOMA_DEV_URL ?? 'https://localhost:5173'

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true })
const page = await context.newPage()
page.on('pageerror', e => console.log(`page error: ${e.message}`))
await page.goto(`${APP}/`, { waitUntil: 'load' })
await page.waitForFunction(() => !!window.__collage?.useStore)

const wsId = await page.evaluate(() => {
  return window.__collage.useStore.getState().addWorkspace()
})
await page.evaluate((id) => {
  window.location.hash = `#/w/${id}`
}, wsId)
await page.waitForSelector('.stage-checker')

function scaleOf() {
  return page.evaluate(() => {
    return Number(document.querySelector('[data-canvas-view]')?.getAttribute('data-canvas-view') ?? 1)
  })
}

// A point that is really the air: the topmost target there is inside the wrap
// and outside the canvas. Re-scan after any zoom, because the canvas transform
// grows visually into the margins and portaled chrome covers hardcoded spots.
function findAir() {
  return page.evaluate(() => {
    const wrap = document.querySelector('.stage-checker')
    const canvas = document.querySelector('[data-canvas-view]')
    const r = wrap.getBoundingClientRect()
    for (let x = r.x + 8; x < r.x + r.width; x += 24) {
      for (let y = r.y + 8; y < r.y + r.height; y += 24) {
        const el = document.elementFromPoint(x, y)
        if (el && wrap.contains(el) && !canvas.contains(el))
          return { x, y }
      }
    }
    return null
  })
}

// Zoom the view with a ctrl+wheel over the stage air: a plain wheel there is
// the canvas size rail, and wheels over the canvas itself are ignored. Keep
// the zoom small so air bands survive the canvas growing.
const air = await findAir()
if (!air)
  throw new Error('no stage air point found inside .stage-checker')
console.log(`air point at ${air.x},${air.y}`)
await page.mouse.move(air.x, air.y)
await page.keyboard.down('Control')
await page.mouse.wheel(0, -150)
await page.keyboard.up('Control')
await page.waitForTimeout(300)
const zoomed = await scaleOf()
console.log(`zoomed scale=${zoomed}`)
if (zoomed === 1)
  throw new Error('wheel zoom did not take; scale still 1')

// The dock chrome is portaled to a host outside .stage-checker.
const inStage = await page.evaluate(() => {
  const dock = document.querySelector('.dock-surface')
  return { dockFound: !!dock, dockInsideStage: !!dock && document.querySelector('.stage-checker').contains(dock) }
})
console.log(`dock: found=${inStage.dockFound} insideStage=${inStage.dockInsideStage}`)
if (!inStage.dockFound)
  throw new Error('dock surface not found; seed a pane first')

// Double-click on the dock chrome: must NOT reset the view.
const dockBox = await page.locator('.dock-surface').first().boundingBox()
await page.mouse.dblclick(dockBox.x + dockBox.width / 2, dockBox.y + 4)
await page.waitForTimeout(300)
const afterDock = await scaleOf()
console.log(`after dock dblclick scale=${afterDock}`)

// Control: double-click on the (post-zoom) stage air fits the view again.
const airAfterZoom = await findAir()
if (!airAfterZoom)
  throw new Error('no stage air left after zoom; lower the wheel amount')
await page.mouse.dblclick(airAfterZoom.x, airAfterZoom.y)
await page.waitForTimeout(300)
const afterAir = await scaleOf()
console.log(`after stage-air dblclick scale=${afterAir}`)

await browser.close()
const guardHeld = afterDock === zoomed
const controlWorked = afterAir === 1
console.log(guardHeld ? 'GUARD-HELD zoom kept through dock double-click' : 'GUARD-FAILED view reset through dock double-click')
console.log(controlWorked ? 'CONTROL-OK stage-air double-click still fits' : 'CONTROL-BROKEN stage-air double-click no longer fits')
process.exit(guardHeld && controlWorked ? 0 : 1)
