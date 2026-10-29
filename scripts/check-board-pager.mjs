// Measures the overview's board pager, jiggle mode, dock collapse and board
// manager against a real Chromium at the four shipped viewports. Every claim
// the lane makes is an assertion here; the PNGs under KOMA_SHOTS are the
// screenshots for visual review, the numbers are the claims.
//
//   KOMA_DEV_URL=https://localhost:5173 bun scripts/check-board-pager.mjs
//
// Playwright-core and the cached Chromium come from this worktree, not a
// global install. The dev server must be the HTTPS one started in the lane's
// worktree; state is seeded through `window.__collage`.
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

function findChromium() {
  const home = process.env.HOME
  const candidates = [
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium-1194/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1129/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    `${home}/Library/Caches/ms-playwright/chromium-1129/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
  ]
  const found = candidates.find(path => existsSync(path))
  if (!found)
    throw new Error('no cached Chromium found; set KOMA_CHROMIUM')
  return found
}

const CHROMIUM = process.env.KOMA_CHROMIUM ?? findChromium()
const APP = process.env.KOMA_DEV_URL ?? 'https://localhost:5173'
const SHOTS = process.env.KOMA_SHOTS ?? '/tmp/koma-board-pager-shots'
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const failures = []
const pageErrors = []

function log(message) {
  console.log(message)
}

function assert(ok, message) {
  if (!ok)
    throw new Error(message)
}

function close(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} (>${tolerance})`)
}

async function scenario(name, fn) {
  try {
    await fn()
    log(`PASS ${name}`)
  }
  catch (error) {
    failures.push({ name, error })
    log(`FAIL ${name}: ${error.message}`)
  }
}

/**
 * Remove the react-grab dev overlay (`src/main.tsx` imports it in every dev
 * build). Its bottom toolbar sits over the app's own footer and intercepts
 * real pointer input there, which would hide the manager's footer controls
 * from this harness. It is not part of the feature; production builds have it
 * too, but a user's real pointer is not driven through a full-screen grab
 * overlay.
 */
async function dismissDevOverlays(page) {
  await page.evaluate(() => {
    for (const el of [...document.querySelectorAll('[data-react-grab], .ph-no-capture')]) {
      let root = el
      while (root.parentElement && root.parentElement !== document.body)
        root = root.parentElement
      if (root !== document.body && !root.contains(document.querySelector('[data-board-manager]')))
        root.remove()
    }
  })
}

async function newPage({ width = 1280, height = 900, touch = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    ignoreHTTPSErrors: true,
    hasTouch: touch,
    reducedMotion,
  })
  const page = await context.newPage()
  page.on('pageerror', e => pageErrors.push(`${width}x${height}: ${e.message}`))
  await page.goto(`${APP}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__collage?.useStore)
  await page.waitForSelector('[data-board-stage]')
  await dismissDevOverlays(page)
  return { context, page }
}

/**
 * Deterministic store state: one seeded board, `boards - 1` blank ones, the
 * first board open, no history. With `photos`, three generated PNGs land in
 * every cell of every board, so the screenshots show real boards.
 */
async function seed(page, boards, { photos = false } = {}) {
  await page.evaluate(async ({ boards, photos }) => {
    const { useStore } = window.__collage
    const base = useStore.getState().workspaces[0]
    const cells = offset => Array.from({ length: 8 }, (_, i) => ({
      ...base,
      id: `seed-${offset}-${i}`,
      canvasRatio: 1,
      canvasFill: 1,
      root: { ...base.root, id: `seed-pane-${offset}-${i}`, photoId: null },
      stickers: [],
      labels: [],
    }))
    const first = cells(0)
    useStore.getState().hydrate({
      meta: {
        grids: [{ id: 'seed-g0', name: '1', workspaces: first, activeId: first[0].id }],
        activeGridId: 'seed-g0',
        workspaces: first,
        activeId: first[0].id,
        gap: 0,
        radius: 0,
        bg: '#141414',
        longSide: 2048,
        format: 'image/jpeg',
        quality: 0.92,
      },
      photos: [],
    })
    if (photos) {
      const colors = [['#d97706', '#7c2d12'], ['#2563eb', '#0f172a'], ['#059669', '#064e3b']]
      const files = []
      for (const [from, to] of colors) {
        const c = document.createElement('canvas')
        c.width = 600
        c.height = 600
        const ctx = c.getContext('2d')
        const g = ctx.createLinearGradient(0, 0, 600, 600)
        g.addColorStop(0, from)
        g.addColorStop(1, to)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 600, 600)
        ctx.fillStyle = 'rgba(255,255,255,0.65)'
        ctx.font = 'bold 240px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('K', 300, 300)
        const blob = await new Promise(r => c.toBlob(r, 'image/png'))
        files.push(new File([blob], `seed-${from}.png`, { type: 'image/png' }))
      }
      useStore.getState().addPhotos(files, false)
    }
    for (let i = 1; i < boards; i++)
      useStore.getState().addGrid()
    if (photos) {
      const now = useStore.getState()
      const ids = now.photos.map(p => p.id)
      const paint = (list, k) => list.map((w, i) => ({ ...w, canvasRatio: 1, root: { ...w.root, photoId: ids[(i + k) % ids.length] } }))
      useStore.setState(s => ({
        workspaces: paint(s.workspaces, 0),
        parkedBoards: Object.fromEntries(Object.entries(s.parkedBoards).map(([id, b], k) => [id, { ...b, workspaces: paint(b.workspaces, k + 1) }])),
      }))
    }
    useStore.getState().resetHistory()
    useStore.getState().switchGrid(useStore.getState().grids[0].id)
  }, { boards, photos })
  await page.waitForTimeout(photos ? 500 : 150)
}

function stateOf(page) {
  return page.evaluate(() => {
    const s = window.__collage.store()
    return {
      activeGridId: s.activeGridId,
      gridIds: s.grids.map(g => g.id),
      activeIdx: s.grids.findIndex(g => g.id === s.activeGridId),
      workspaces: s.workspaces.map(w => w.id),
      cellCount: s.workspaces.length,
      boardCount: s.grids.length,
    }
  })
}

function rectOf(page, selector, index = 0) {
  return page.evaluate(({ selector, index }) => {
    const el = document.querySelectorAll(selector)[index]
    if (!el)
      return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left }
  }, { selector, index })
}

const activeCellBox = page => rectOf(page, '[data-board-page-active] [data-cell]', 0)
const pageBox = (page, id) => rectOf(page, `[data-board-page-id="${id}"]`, 0)

async function waitSettled(page, ms = 650) {
  await page.waitForFunction(() => !document.querySelector('[data-board-stage]')?.hasAttribute('data-paging'), null, { timeout: 3000 })
  await page.waitForTimeout(ms)
}

async function waitActive(page, id, timeout = 2500) {
  await page.waitForFunction(expected => window.__collage.store().activeGridId === expected, id, { timeout })
}

/**
 * A press point on the stage air. The top/bottom padding is outside the board
 * column; `side` picks the end a drag starts from so the pointer stays inside
 * the viewport (`left` for a rightward drag, `right` for a leftward one).
 */
async function findAir(page, { side = 'center' } = {}) {
  return page.evaluate(({ side }) => {
    const stage = document.querySelector('[data-board-stage]')
    if (!stage)
      return null
    const r = stage.getBoundingClientRect()
    const air = (x, y) => {
      const el = document.elementFromPoint(x, y)
      return el && stage.contains(el)
        && !el.closest('[data-canvas-view]')
        && !el.closest('button, a[href], [data-board-dots], [data-dock-mode], [role="dialog"], [data-add-cell]')
    }
    const xs = side === 'left'
      ? [r.x + 20, r.x + r.width * 0.25, r.x + r.width / 2]
      : side === 'right'
        ? [r.right - 20, r.x + r.width * 0.75, r.x + r.width / 2]
        : [r.x + r.width / 2, r.x + r.width * 0.25, r.x + r.width * 0.75]
    const ys = [r.y + 4, r.y + 8, r.bottom - 4, r.bottom - 8, r.y + r.height / 2]
    const quick = ys.flatMap(y => xs.map(x => ({ x, y })))
    const scan = []
    for (let x = r.x + 6; x < r.right - 6; x += 6) {
      for (let y = r.y + 4; y < r.bottom - 4; y += 6)
        scan.push({ x, y })
    }
    return [...quick, ...scan].find(p => air(p.x, p.y)) ?? null
  }, { side })
}

async function cellPoint(page, index = 0) {
  const box = await page.evaluate((index) => {
    const el = document.querySelectorAll('[data-board-page-active] [data-cell]')[index]
    if (!el)
      return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, box: { x: r.x, y: r.y, w: r.width, h: r.height } }
  }, index)
  assert(box, 'no live cell to press')
  return box
}

async function dotsPoint(page) {
  const box = await rectOf(page, '[data-board-dots]')
  assert(box, 'no page dots')
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, box }
}

/**
 * One CDP touch session per page, reused: a session detached between drags
 * can leave the next touch sequence undelivered in headless Chromium.
 */
const touchSessions = new WeakMap()

async function touchSession(page) {
  const existing = touchSessions.get(page)
  if (existing)
    return existing
  const client = await page.context().newCDPSession(page)
  const point = (x, y) => ({ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 })
  const session = {
    start: (x, y) => client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(x, y)] }),
    move: (x, y) => client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x, y)] }),
    end: () => client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    cancel: () => client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
  }
  touchSessions.set(page, session)
  return session
}

async function touchDrag(page, from, { dx = 0, dy = 0, steps = 8, stepMs = 16, holdMs = 0, during, release = true } = {}) {
  const touch = await touchSession(page)
  await touch.start(from.x, from.y)
  if (holdMs)
    await page.waitForTimeout(holdMs)
  for (let i = 1; i <= steps; i++) {
    await touch.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps)
    await page.waitForTimeout(stepMs)
  }
  if (during)
    await during()
  if (release)
    await touch.end()
}

async function mouseDrag(page, from, to, { steps = 12, stepMs = 16, holdMs = 0, during, release = true } = {}) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  if (holdMs)
    await page.waitForTimeout(holdMs)
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
    await page.waitForTimeout(stepMs)
  }
  if (during)
    await during()
  if (release)
    await page.mouse.up()
}

async function mouseHold(page, point, ms) {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

/**
 * The real hit test at a point: `elementsFromPoint` reports decorative
 * overlays (the environment injects a full-screen `pointer-events: none`
 * element), so the first element that actually takes the pointer is the one
 * under it.
 */
async function hitTest(page, x, y) {
  return page.evaluate(({ x, y }) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (getComputedStyle(el).pointerEvents === 'none')
        continue
      return {
        tag: el.tagName,
        dialog: !!el.closest('[role="dialog"]'),
        dots: !!el.closest('[data-board-dots]'),
      }
    }
    return null
  }, { x, y })
}

/**
 * A real click at an element's centre. The environment injects a full-screen
 * react-grab overlay that Playwright's actionability check treats as an
 * interceptor, while real pointer input passes through it (its
 * `pointer-events` is none). Mouse input is the honest click.
 */
async function clickAt(page, selector, index = 0) {
  const box = await rectOf(page, selector, index)
  assert(box, `nothing to click for ${selector}[${index}]`)
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2)
}

async function startSampler(page, pageId) {
  await page.evaluate((pageId) => {
    window.__samples = []
    window.__sampling = true
    const tick = () => {
      const page = document.querySelector(`[data-board-page-id="${pageId}"]`)
      const el = page?.querySelector('[data-cell-slot]')
      const r = el?.getBoundingClientRect()
      window.__samples.push(r
        ? { t: performance.now(), x: r.x, y: r.y, w: r.width, h: r.height, active: page?.hasAttribute('data-board-page-active') === true }
        : { t: performance.now(), active: page?.hasAttribute('data-board-page-active') === true })
      if (window.__sampling)
        requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, pageId)
}

async function stopSampler(page) {
  return page.evaluate(() => {
    window.__sampling = false
    return window.__samples
  })
}

await scenario('cell quick swipe pages, tracks 1:1, no reorder overlay', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 3)
  const before = await stateOf(page)
  const cell = await cellPoint(page, 0)
  const pre = cell.box
  let mid = null
  await touchDrag(page, cell, {
    dx: -140,
    steps: 6,
    stepMs: 14,
    during: async () => {
      mid = await activeCellBox(page)
      const overlay = await page.evaluate(() => document.querySelectorAll('[data-drag-overlay]').length)
      assert(overlay === 0, `a reorder overlay appeared during a page swipe (${overlay})`)
    },
  })
  assert(mid, 'no mid-drag sample')
  close(mid.x - pre.x, -140, 1.5, 'mid-drag cell tracks the finger 1:1')
  await waitActive(page, before.gridIds[1])
  await waitSettled(page)
  const after = await stateOf(page)
  assert(after.activeIdx === 1, `quick cell swipe did not page (activeIdx ${after.activeIdx})`)
  assert(!page.url().includes('/w/'), `the swipe navigated away from the overview: ${page.url()}`)
  const landed = await activeCellBox(page)
  close(landed.x, pre.x, 1.5, 'the landed page occupies the old page\'s exact slot')
  log(`  1:1 delta ${(mid.x - pre.x).toFixed(2)}px; landed cell x ${landed.x.toFixed(2)} vs ${pre.x.toFixed(2)}`)
  await context.close()
})

await scenario('slow drag settles home; the first page rubber-bands; a flick crosses pages', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 4)
  const air = await findAir(page, { side: 'left' })
  assert(air, 'no stage air found')
  const pre = await activeCellBox(page)

  await mouseDrag(page, air, { x: air.x - 60, y: air.y }, { steps: 12, stepMs: 25 })
  await waitSettled(page)
  assert((await stateOf(page)).activeIdx === 0, 'a slow 60px drag changed the page')
  const home = await activeCellBox(page)
  close(home.x, pre.x, 0.5, 'a snap-home returns the cell to its rest x')

  let lean = null
  await mouseDrag(page, air, { x: air.x + 200, y: air.y }, {
    steps: 10,
    stepMs: 20,
    during: async () => {
      lean = await activeCellBox(page)
    },
  })
  assert(lean, 'no rubber-band sample')
  const travel = await page.evaluate(() => {
    const v = document.querySelector('[data-board-viewport]')?.getBoundingClientRect()
    return v ? Math.round(v.width + Math.max(16, v.width * 0.06)) : 0
  })
  const offset = lean.x - pre.x
  assert(offset > 0, `the first page did not lean (${offset})`)
  assert(offset < travel * 0.35 + 1, `the rubber band exceeded 0.35 page (${offset} vs travel ${travel})`)
  log(`  rubber band ${offset.toFixed(2)}px of a ${travel}px page`)
  await waitSettled(page)
  assert((await stateOf(page)).activeIdx === 0, 'the rubber-banded page did not spring home')

  // A leftward flick crosses at least two pages. It starts at the stage's
  // right air so the 300px of travel stays inside the 375px viewport.
  const before = await stateOf(page)
  const flickFrom = await findAir(page, { side: 'right' })
  assert(flickFrom, 'no right-side air found')
  await mouseDrag(page, flickFrom, { x: flickFrom.x - 300, y: flickFrom.y }, { steps: 4, stepMs: 16 })
  await page.waitForFunction(
    () => window.__collage.store().grids.findIndex(g => g.id === window.__collage.store().activeGridId) >= 2,
    null,
    { timeout: 2500 },
  )
  await waitSettled(page)
  const after = await stateOf(page)
  assert(after.activeIdx >= 2, `a 650px flick landed on page ${after.activeIdx}, not 2+`)
  const dotIndex = await page.evaluate(() => [...document.querySelectorAll('[data-board-dots] span')].findIndex(s => s.hasAttribute('data-dot-active')))
  const dotCount = await page.evaluate(() => document.querySelectorAll('[data-board-dots] span').length)
  assert(dotIndex === after.activeIdx, `the dots mark ${dotIndex}, the board ${after.activeIdx}`)
  assert(dotCount === after.boardCount, `the dots count ${dotCount}, the boards ${after.boardCount}`)
  log(`  flick from page ${before.activeIdx} to ${after.activeIdx}; dots ${dotIndex} of ${dotCount}`)
  await context.close()
})

await scenario('the landing frame is continuous', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 2)
  const before = await stateOf(page)
  const target = before.gridIds[1]
  const targetBox = await pageBox(page, target)
  assert(targetBox, 'the neighbour page is not rendered')
  const air = await findAir(page, { side: 'right' })
  await mouseDrag(page, air, { x: air.x - 260, y: air.y }, {
    steps: 6,
    stepMs: 16,
    during: async () => {
      await startSampler(page, target)
    },
  })
  await waitSettled(page)
  const samples = (await stopSampler(page)).filter(s => s.x != null)
  assert(samples.length > 5, `too few frames sampled (${samples.length})`)
  let maxStep = 0
  let landingJump = null
  for (let i = 1; i < samples.length; i++) {
    const step = Math.abs(samples[i].x - samples[i - 1].x)
    maxStep = Math.max(maxStep, step)
    if (!samples[i - 1].active && samples[i].active)
      landingJump = step
  }
  assert(landingJump != null, 'the sampler never saw the target page become live')
  assert(landingJump <= 1.5, `the landing frame jumped ${landingJump.toFixed(2)}px`)
  assert((await stateOf(page)).activeIdx === 1, 'the swipe did not land on the neighbour')
  log(`  ${samples.length} frames; landing step ${landingJump.toFixed(2)}px; max settle step ${maxStep.toFixed(2)}px`)
  await context.close()
})

await scenario('a 250ms hold reorders for touch; it does not page', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 2)
  const before = await stateOf(page)
  const first = await cellPoint(page, 0)
  const third = await cellPoint(page, 2)
  let overlay = 0
  await touchDrag(page, first, {
    dx: third.x - first.x,
    steps: 6,
    stepMs: 16,
    holdMs: 320,
    during: async () => {
      overlay = await page.evaluate(() => document.querySelectorAll('[data-drag-overlay]').length)
    },
  })
  await page.waitForTimeout(250)
  assert(overlay > 0, 'a 320ms touch hold did not show a reorder overlay')
  const after = await stateOf(page)
  assert(after.activeGridId === before.activeGridId, 'a hold reorder changed the page')
  assert(after.workspaces[0] !== before.workspaces[0], 'the held cell did not reorder')
  log(`  touch hold: cell order ${before.workspaces.slice(0, 3).join(',')} → ${after.workspaces.slice(0, 3).join(',')}`)
  await context.close()
})

await scenario('a quick mouse drag from a cell pages; a 250ms mouse hold reorders', async () => {
  const quick = await newPage({ width: 1280, height: 900 })
  await seed(quick.page, 2)
  const quickBefore = await stateOf(quick.page)
  const quickFirst = await cellPoint(quick.page, 0)
  let quickOverlay = 0
  await mouseDrag(quick.page, quickFirst, { x: quickFirst.x - 80, y: quickFirst.y }, {
    steps: 6,
    stepMs: 14,
    during: async () => {
      quickOverlay = await quick.page.evaluate(() => document.querySelectorAll('[data-drag-overlay]').length)
    },
  })
  await waitActive(quick.page, quickBefore.gridIds[1])
  await waitSettled(quick.page)
  assert(quickOverlay === 0, 'a quick mouse cell drag showed a reorder overlay')
  assert((await stateOf(quick.page)).activeIdx === 1, 'a quick mouse cell drag did not page')
  await quick.context.close()

  const { context, page } = await newPage({ width: 1280, height: 900 })
  await seed(page, 2)
  const before = await stateOf(page)
  const first = await cellPoint(page, 0)
  const third = await cellPoint(page, 2)
  let overlay = 0
  await mouseDrag(page, first, third, {
    steps: 8,
    holdMs: 320,
    during: async () => {
      overlay = await page.evaluate(() => document.querySelectorAll('[data-drag-overlay]').length)
    },
  })
  await page.waitForTimeout(250)
  assert(overlay > 0, 'a 320ms mouse hold did not show a reorder overlay')
  const after = await stateOf(page)
  assert(after.activeGridId === before.activeGridId, 'a mouse hold reorder changed the page')
  assert(after.workspaces[0] !== before.workspaces[0], 'the held cell did not reorder')
  await context.close()
})

await scenario('the dock slides away and the board geometry stays put', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 2)
  const preCell = await activeCellBox(page)
  const preDots = await dotsPoint(page)
  const preDock = await rectOf(page, '[data-dock-mode]')
  const preStageH = await page.evaluate(() => document.querySelector('[data-board-stage]')?.clientHeight)
  const air = await findAir(page, { side: 'right' })
  assert(air, 'no air for the dock swipe')
  let mid = null
  await mouseDrag(page, air, { x: air.x - 120, y: air.y }, {
    steps: 6,
    stepMs: 16,
    during: async () => {
      await page.waitForTimeout(240)
      mid = {
        cell: await activeCellBox(page),
        dots: await dotsPoint(page),
        dock: await rectOf(page, '[data-dock-mode]'),
        root: await rectOf(page, '.tools-dock'),
        inert: await page.evaluate(() => document.querySelector('.tools-dock')?.hasAttribute('inert')),
        stageH: await page.evaluate(() => document.querySelector('[data-board-stage]')?.clientHeight),
      }
    },
  })
  await waitSettled(page, 800)
  const afterCell = await activeCellBox(page)
  const afterDots = await dotsPoint(page)
  const afterDock = await rectOf(page, '[data-dock-mode]')
  const afterInert = await page.evaluate(() => document.querySelector('.tools-dock')?.hasAttribute('inert'))
  const viewportH = 812
  assert(mid, 'no mid-swipe dock sample')
  assert(mid.inert === true, 'the dock was not inert mid-swipe')
  close(mid.cell.w, preCell.w, 0.5, 'cell width changed mid-swipe')
  close(mid.cell.h, preCell.h, 0.5, 'cell height changed mid-swipe')
  close(mid.cell.top, preCell.top, 0.5, 'cell top changed mid-swipe')
  close(mid.stageH, preStageH, 0.5, 'the stage height changed mid-swipe')
  assert(mid.dock.top > viewportH - 1, `the sheet did not leave the viewport (top ${mid.dock.top})`)
  close(mid.dots.x, preDots.x, 0.5, 'the dots moved mid-swipe')
  log(`  mid-swipe sheet top ${mid.dock.top.toFixed(0)} (>${viewportH}); root top ${mid.root.top.toFixed(0)}`)
  close(afterCell.w, preCell.w, 0.5, 'cell width changed after the swipe')
  close(afterCell.h, preCell.h, 0.5, 'cell height changed after the swipe')
  close(afterCell.top, preCell.top, 0.5, 'cell top changed after the swipe')
  close(afterDock.top, preDock.top, 1, 'the dock did not return to its seat')
  assert(afterInert === false, 'the dock stayed inert after the swipe')
  close(afterDots.x, preDots.x, 0.5, 'the dots did not return')
  log(`  dock top before ${preDock.top.toFixed(0)}, after ${afterDock.top.toFixed(0)}; cell ${preCell.w.toFixed(1)}×${preCell.h.toFixed(1)} held`)
  await context.close()
})

await scenario('the dots stay tappable during a swipe and open the manager', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 2)
  const dots = await dotsPoint(page)
  const target = (await stateOf(page)).gridIds[1]
  const pageRect = await pageBox(page, target)
  assert(pageRect.bottom <= dots.box.top + 0.5, `the board overlaps the dots row by ${pageRect.bottom - dots.box.top}px`)
  let hit = null
  const air = await findAir(page, { side: 'right' })
  assert(air, 'no air for the dots swipe')
  await mouseDrag(page, air, { x: air.x - 90, y: air.y }, {
    steps: 6,
    stepMs: 16,
    during: async () => {
      hit = await hitTest(page, dots.x, dots.y)
    },
  })
  assert(hit?.dots, `the dots are not hit-testable mid-swipe (${JSON.stringify(hit)})`)
  await waitSettled(page)
  await page.locator('[data-board-dots]').click()
  await page.waitForSelector('[data-board-manager]')
  await dismissDevOverlays(page)
  assert(await page.evaluate(() => !!document.querySelector('[role="dialog"]')), 'the manager dialog did not open')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await context.close()
})

async function enterJiggle(page) {
  const air = await findAir(page)
  assert(air, 'no air point for the jiggle hold')
  await mouseHold(page, air, 650)
  await page.waitForTimeout(120)
}

await scenario('jiggle enters, deletes via the X, and exits three ways', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 2)
  await enterJiggle(page)
  const counts = await page.evaluate(() => ({
    jiggle: document.querySelectorAll('[data-jiggle]').length,
    deletes: document.querySelectorAll('[data-cell-delete]').length,
    done: !!document.querySelector('[data-jiggle-done]'),
    cells: document.querySelectorAll('[data-board-page-active] [data-cell]').length,
  }))
  assert(counts.done, 'jiggle mode has no Done button')
  assert(counts.jiggle === counts.cells && counts.jiggle > 0, `jiggle faces ${counts.jiggle} of ${counts.cells}`)
  assert(counts.deletes === counts.cells, `X badges ${counts.deletes} of ${counts.cells}`)
  await page.locator('[data-cell-delete]').nth(0).click()
  await page.waitForTimeout(120)
  await page.locator('[data-cell-delete]').nth(0).click()
  await page.waitForTimeout(120)
  const afterDelete = await stateOf(page)
  assert(afterDelete.cellCount === counts.cells - 2, `two X taps removed ${counts.cells - afterDelete.cellCount} cells`)
  await page.locator('[data-jiggle-done]').click()
  await page.waitForTimeout(120)
  assert(await page.evaluate(() => document.querySelectorAll('[data-jiggle]').length) === 0, 'Done did not leave jiggle')
  await enterJiggle(page)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
  assert(await page.evaluate(() => document.querySelectorAll('[data-jiggle]').length) === 0, 'Esc did not leave jiggle')
  await enterJiggle(page)
  const air = await findAir(page)
  await page.mouse.click(air.x, air.y)
  await page.waitForTimeout(120)
  assert(await page.evaluate(() => document.querySelectorAll('[data-jiggle]').length) === 0, 'an air tap did not leave jiggle')
  log(`  jiggle faces ${counts.jiggle}, X badges ${counts.deletes}; two taps left ${afterDelete.cellCount} cells`)
  await context.close()
})

await scenario('jiggle under reduced motion is still, and the X still works', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true, reducedMotion: 'reduce' })
  await seed(page, 2)
  await enterJiggle(page)
  const face = await page.evaluate(() => {
    const el = document.querySelector('[data-jiggle]')
    return el ? { transform: getComputedStyle(el).transform, animation: getComputedStyle(el).animationName } : null
  })
  assert(face, 'no jiggle face under reduced motion')
  assert(face.transform === 'none' || face.transform === 'matrix(1, 0, 0, 1, 0, 0)', `the face still moves under reduced motion: ${face.transform}`)
  const before = await stateOf(page)
  await page.locator('[data-cell-delete]').nth(0).click()
  await page.waitForTimeout(150)
  assert((await stateOf(page)).cellCount === before.cellCount - 1, 'the X did not delete under reduced motion')
  log(`  reduced-motion transform ${face.transform} (animation ${face.animation})`)
  await context.close()
})

// A press that catches a page settle must complete that landing. In jiggle the
// air tap may not exit the mode while the stopped settle leaves the track
// parked and the dock away.
await scenario('a caught settle completes before the jiggle air tap exits', async () => {
  const { context, page } = await newPage({ width: 375, height: 812 })
  await seed(page, 2)
  await enterJiggle(page)
  const before = await stateOf(page)
  const home = await pageBox(page, before.gridIds[before.activeIdx])
  const air = await findAir(page, { side: 'right' })
  assert(air, 'no air point for the caught settle')
  await mouseDrag(page, air, { x: air.x - 170, y: air.y }, { steps: 4, stepMs: 8 })
  await page.mouse.move(air.x, air.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(500)
  const after = await stateOf(page)
  const done = await page.evaluate(() => !!document.querySelector('[data-jiggle-done]'))
  const inert = await page.evaluate(() => document.querySelector('.tools-dock')?.hasAttribute('inert') ?? false)
  const landed = await pageBox(page, after.gridIds[after.activeIdx])
  assert(done, 'the caught settle let the air tap exit jiggle')
  assert(!inert, 'the dock stayed collapsed after the caught settle')
  assert(Math.abs(landed.x - home.x) <= 1.5, `the caught settle left the page ${(landed.x - home.x).toFixed(1)}px off home`)
  log(`  caught settle: page ${before.activeIdx} -> ${after.activeIdx}, jiggle kept, dock back, home delta ${(landed.x - home.x).toFixed(2)}px`)
  await context.close()
})

await scenario('the manager covers the app, fits, reorders, batch-deletes and adds', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 4, { photos: true })
  await page.locator('[data-board-dots]').click()
  await page.waitForSelector('[data-board-manager]')
  await dismissDevOverlays(page)
  const popup = await rectOf(page, '[data-board-manager]')
  const viewport = page.viewportSize()
  close(popup.x, 0, 0.5, 'the manager popup x')
  close(popup.y, 0, 0.5, 'the manager popup y')
  close(popup.w, viewport.width, 0.5, 'the manager popup width')
  close(popup.h, viewport.height, 0.5, 'the manager popup height')
  const hitTop = await hitTest(page, 10, 10)
  const hitDock = await hitTest(page, viewport.width / 2, viewport.height - 20)
  assert(hitTop?.dialog && hitDock?.dialog, `the manager does not cover the app chrome (top ${JSON.stringify(hitTop)}, dock ${JSON.stringify(hitDock)})`)
  const fit = await page.evaluate(() => {
    const content = document.querySelector('[data-manager-content]')
    const cards = [...document.querySelectorAll('[data-board-card]')]
    const cr = content.getBoundingClientRect()
    const boxes = cards.map((c) => {
      const r = c.getBoundingClientRect()
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }
    })
    return {
      scrolls: content.scrollHeight > content.clientHeight + 1 || content.scrollWidth > content.clientWidth + 1,
      inside: boxes.every(b => b.x >= cr.x - 1 && b.y >= cr.y - 1 && b.right <= cr.right + 1 && b.bottom <= cr.bottom + 1),
      cards: boxes.length,
      thumbs: document.querySelectorAll('[data-board-thumb]').length,
      cardBox: boxes[0],
      contentBox: { w: cr.width, h: cr.height },
    }
  })
  assert(fit.cards === 4 && fit.thumbs === 4, `the manager shows ${fit.cards} cards and ${fit.thumbs} thumbs`)
  assert(!fit.scrolls, 'the manager content scrolls; every board is not scaled to the viewport')
  assert(fit.inside, 'a board card left the manager content box')
  log(`  375x812 manager: card ${fit.cardBox.right - fit.cardBox.x}×${fit.cardBox.bottom - fit.cardBox.y}, no scroll`)

  const before = await stateOf(page)
  const h0 = await rectOf(page, '[data-board-handle]', 0)
  const c1 = await rectOf(page, '[data-board-card]', 1)
  await mouseDrag(page, { x: h0.x + h0.w / 2, y: h0.y + h0.h / 2 }, { x: c1.x + c1.w / 2, y: c1.y + c1.h / 2 }, { steps: 14, stepMs: 16 })
  await page.waitForTimeout(300)
  const reordered = await stateOf(page)
  assert(reordered.gridIds[0] === before.gridIds[1] && reordered.gridIds[1] === before.gridIds[0], `reorder gave ${reordered.gridIds} from ${before.gridIds}`)
  await page.evaluate(() => window.__collage.store().undo())
  await page.waitForTimeout(250)
  assert((await stateOf(page)).gridIds.join() === before.gridIds.join(), 'undo did not restore the order')

  const activeId = before.activeGridId
  const victim = before.gridIds[2]
  await clickAt(page, '[data-board-card] input[type="checkbox"]', 0)
  await clickAt(page, '[data-board-card] input[type="checkbox"]', 2)
  const selection = await page.evaluate(() => ({
    checked: [...document.querySelectorAll('[data-board-card] input')].map(i => i.checked),
    count: document.querySelector('[data-board-manager] footer span')?.textContent,
    disabled: document.querySelector('[data-manager-delete]')?.disabled,
  }))
  log(`  selection after two checks: ${JSON.stringify(selection)}`)
  await dismissDevOverlays(page)
  await clickAt(page, '[data-manager-delete]')
  await page.waitForTimeout(250)
  const deleted = await stateOf(page)
  assert(deleted.gridIds.length === 2, `batch delete left ${deleted.gridIds.length} boards`)
  assert(!deleted.gridIds.includes(activeId) && !deleted.gridIds.includes(victim), 'the deleted boards are still listed')
  assert(deleted.activeGridId === before.gridIds[1], `the survivor rule opened ${deleted.activeGridId}, not ${before.gridIds[1]}`)
  await page.evaluate(() => window.__collage.store().undo())
  await page.waitForTimeout(250)
  const restored = await stateOf(page)
  assert(restored.gridIds.join() === before.gridIds.join(), 'undo did not restore every board')
  assert(restored.activeGridId === activeId, 'undo did not restore the open board')
  log(`  batch delete 4→2 in one step; one undo restored 4 and reopened ${activeId}`)

  await clickAt(page, '[data-board-card] input[type="checkbox"]', 0)
  await dismissDevOverlays(page)
  await clickAt(page, '[data-manager-delete]')
  await page.waitForTimeout(250)
  await dismissDevOverlays(page)
  await clickAt(page, '[data-manager-add]')
  await page.waitForTimeout(300)
  const added = await page.evaluate(() => {
    const s = window.__collage.store()
    return {
      boards: s.grids.length,
      active: s.activeGridId,
      dialog: !!document.querySelector('[data-board-manager]'),
      photos: s.workspaces.filter(w => s.photos.length && window.__collage.panes.leafList(w.root).some(l => l.photoId)).length,
      addDisabled: document.querySelector('[data-manager-add]')?.disabled,
    }
  })
  assert(added.boards === 4, `add made ${added.boards} boards`)
  assert(added.dialog, 'the manager closed on add')
  assert(added.photos === 0, 'the new board was a copy, not blank')
  assert(added.addDisabled === true, 'Add a board is not disabled at the cap')
  const openTarget = (await stateOf(page)).gridIds[1]
  await dismissDevOverlays(page)
  await clickAt(page, '[data-board-preview]', 1)
  await page.waitForTimeout(350)
  const opened = await stateOf(page)
  assert(opened.activeGridId === openTarget, `the card preview opened ${opened.activeGridId}, not ${openTarget}`)
  assert(!(await page.evaluate(() => !!document.querySelector('[data-board-manager]'))), 'the manager stayed open after opening a board')
  await context.close()
})

await scenario('paging at 1.5x and 2.5x stays 1:1', async () => {
  const { context, page } = await newPage({ width: 1280, height: 900, touch: true })
  await seed(page, 3)
  const air = await findAir(page, { side: 'right' })
  const dotsBefore = await dotsPoint(page)
  for (let i = 0; i < 14; i++) {
    await page.mouse.move(air.x, air.y)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -120)
    await page.keyboard.up('Control')
    await page.waitForTimeout(30)
    const scale = await page.evaluate(() => Number(document.querySelector('[data-canvas-view]')?.getAttribute('data-canvas-view') ?? 1))
    if (scale >= 1.5)
      break
  }
  const scale = await page.evaluate(() => Number(document.querySelector('[data-canvas-view]')?.getAttribute('data-canvas-view') ?? 1))
  assert(scale >= 1.45, `the view zoom did not reach 1.5 (${scale})`)
  const dots = await dotsPoint(page)
  close(dots.box.w, dotsBefore.box.w, 0.5, 'the dots scaled with the view zoom')
  const air2 = await findAir(page, { side: 'right' })
  assert(air2, 'no air left at 1.5x')
  const pre = await activeCellBox(page)
  let mid = null
  await mouseDrag(page, air2, { x: air2.x - 140, y: air2.y }, {
    steps: 8,
    stepMs: 16,
    during: async () => {
      mid = await activeCellBox(page)
    },
  })
  assert(mid, 'no mid-drag sample at 1.5x')
  close(mid.x - pre.x, -140, 2, 'the pager is not 1:1 at 1.5x')
  await waitSettled(page)
  log(`  zoom ${scale.toFixed(2)}: 1:1 delta ${(mid.x - pre.x).toFixed(2)}px; dots ${dots.box.w.toFixed(1)}px unchanged`)

  // 2.5x: the scaled column covers the stage air, so the synthetic wheel goes
  // to the wrap itself (the pager assertion below is still a real touch drag).
  await page.evaluate(() => {
    const wrap = document.querySelector('.stage-checker')
    for (let i = 0; i < 30; i++)
      wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(120)
  const scale2 = await page.evaluate(() => Number(document.querySelector('[data-canvas-view]')?.getAttribute('data-canvas-view') ?? 1))
  assert(scale2 >= 2.45, `the view zoom did not reach 2.5 (${scale2})`)
  const dots2 = await dotsPoint(page)
  close(dots2.box.w, dotsBefore.box.w, 0.5, 'the dots scaled at 2.5x')
  const cell2 = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-board-page-active] [data-cell]')) {
      const r = el.getBoundingClientRect()
      const x = r.x + r.width / 2
      const y = r.y + r.height / 2
      if (x > 4 && x < innerWidth - 4 && y > 4 && y < innerHeight - 4)
        return { x, y, box: { x: r.x, y: r.y, w: r.width, h: r.height } }
    }
    return null
  })
  assert(cell2, 'no cell centre is on screen at 2.5x')
  const pre2 = cell2.box
  let mid2 = null
  await touchDrag(page, cell2, {
    dx: -140,
    steps: 8,
    stepMs: 16,
    during: async () => {
      mid2 = await activeCellBox(page)
    },
  })
  assert(mid2, 'no mid-drag sample at 2.5x')
  close(mid2.x - pre2.x, -140, 2, 'the pager is not 1:1 at 2.5x')
  await waitSettled(page)
  log(`  zoom ${scale2.toFixed(2)}: 1:1 delta ${(mid2.x - pre2.x).toFixed(2)}px; dots ${dots2.box.w.toFixed(1)}px unchanged`)
  await context.close()
})

const VIEWPORTS = [
  { width: 375, height: 812, touch: true },
  { width: 1280, height: 900, touch: false },
  { width: 1280, height: 600, touch: false },
  { width: 915, height: 412, touch: true },
]

await scenario('screenshots at every shipped viewport', async () => {
  for (const viewport of VIEWPORTS) {
    const { context, page } = await newPage(viewport)
    await seed(page, 4, { photos: true })
    const tag = `${viewport.width}x${viewport.height}`
    await dismissDevOverlays(page)
    await page.screenshot({ path: join(SHOTS, `overview-${tag}.png`) })
    const dots = await dotsPoint(page)
    const board = await pageBox(page, (await stateOf(page)).gridIds[0])
    assert(board.bottom <= dots.box.top + 0.5, `${tag}: the board overlaps the dots by ${(board.bottom - dots.box.top).toFixed(1)}px`)
    if (viewport.width === 915) {
      log(`  915x412 board bottom ${board.bottom.toFixed(1)}, dots top ${dots.box.top.toFixed(1)}, overlap ${(board.bottom - dots.box.top).toFixed(1)}px`)
    }
    // A mid-swipe frame: hold the next page part-way in so the neighbour's same
    // scale and missing recede/blur are visible.
    const air = await findAir(page, { side: 'right' })
    assert(air, `no air at ${tag}`)
    await mouseDrag(page, air, { x: air.x - Math.round(viewport.width / 8), y: air.y }, {
      steps: 6,
      stepMs: 16,
      during: async () => {
        await page.screenshot({ path: join(SHOTS, `midswipe-${tag}.png`) })
      },
    })
    await waitSettled(page)
    await enterJiggle(page)
    await page.screenshot({ path: join(SHOTS, `jiggle-${tag}.png`) })
    await page.locator('[data-jiggle-done]').click()
    await page.waitForTimeout(250)
    await page.locator('[data-board-dots]').click()
    await page.waitForSelector('[data-board-manager]')
    await dismissDevOverlays(page)
    await page.screenshot({ path: join(SHOTS, `manager-${tag}.png`) })
    log(`  wrote ${tag} screenshots`)
    await context.close()
  }
})

await scenario('the page dots own a 44px hit area', async () => {
  const { context, page } = await newPage({ width: 375, height: 812, touch: true })
  await seed(page, 2)
  const dots = await dotsPoint(page)
  const probe = async (x, y) => (await hitTest(page, x, y))?.dots === true
  const hits = {
    center: await probe(dots.x, dots.y),
    above: await probe(dots.x, dots.y - dots.box.h / 2 - 7),
    below: await probe(dots.x, dots.y + dots.box.h / 2 + 7),
    outer: await probe(dots.x, dots.y - dots.box.h / 2 - 11),
  }
  assert(hits.center && hits.above && hits.below, `the dots' 44px hit area is not reachable: ${JSON.stringify(hits)}`)
  assert(hits.outer === false, 'the dots hit area reaches past 44px')
  log(`  hit box ${dots.box.h}px row + 9px each side; probes ${JSON.stringify(hits)}`)
  await context.close()
})

await browser.close()
if (pageErrors.length) {
  console.error(`Page errors:\n${pageErrors.join('\n')}`)
  failures.push({ name: 'page errors', error: new Error(pageErrors.join('; ')) })
}
if (failures.length) {
  console.error(`\n${failures.length} scenario(s) failed.`)
  for (const f of failures)
    console.error(`- ${f.name}\n  ${f.error.stack ?? f.error.message}`)
  process.exit(1)
}
console.log(`\nAll scenarios passed. Screenshots in ${SHOTS}`)
