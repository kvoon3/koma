/**
 * Browser evidence for the dock's hover/press box and popover hand-over.
 *
 * Everything here is a pixel measurement or a DOM fact: the box lands on the
 * button, a mid-glide sample lies between the two buttons, the hovered button
 * has no background of its own, a hand-over leaves exactly one panel mounted
 * with its trigger open and the row unscrolled, the box follows scroll, touch
 * never hands over, and reduced motion places the box in one frame.
 *
 * Playwright-core and the cached Chromium are local tools, not dependencies, so
 * this runs by hand. It spawns the dev server unless KOMA_DEV_URL is set:
 *   bun scripts/check-dock-glide.mjs
 *   KOMA_DEV_URL=https://localhost:5229 bun scripts/check-dock-glide.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const OUT = process.env.KOMA_SHOTS ?? '/tmp/dock-glide-shots'
const BASE = process.env.KOMA_DEV_URL ?? 'https://localhost:5289'
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
  : spawn('bun', ['run', 'dev', '--', '--port', '5289', '--strictPort'], { stdio: 'ignore' })

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

/** Seed one canvas photo into the active workspace (the filter check's recipe). */
async function seedPhoto(page) {
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

/** Navigate to the editing stage and focus the filled pane. */
async function openStage(page) {
  await seedPhoto(page)
  await page.evaluate(() => {
    location.hash = `#/w/${window.__collage.store().activeId}`
  })
  await page.locator('img').first().waitFor({ state: 'visible', timeout: 20000 })
  await sleep(400)
  const img = await page.locator('img').first().boundingBox()
  await page.mouse.click(img.x + img.width / 2, img.y + img.height / 2)
  await page.locator('button[data-dock-filter]').waitFor({ state: 'visible', timeout: 15000 })
  await sleep(400)
}

async function openGrid(page) {
  await seedPhoto(page)
  await page.evaluate(() => {
    location.hash = '#/'
  })
  await page.locator('button[data-dock-popover="grid"]').waitFor({ state: 'visible', timeout: 20000 })
  await sleep(500)
}

/** A trigger's center, in viewport px. */
async function centerOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox()
  assert(box, `${selector} has no box`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Sample the box every frame for `ms` while `action` runs. */
async function sample(page, ms, action) {
  await page.evaluate((duration) => {
    const box = document.querySelector('[data-dock-highlight]')
    window.__samples = []
    window.__sampling = true
    const started = performance.now()
    const tick = () => {
      const r = box.getBoundingClientRect()
      const cs = getComputedStyle(box)
      window.__samples.push({
        t: Math.round(performance.now() - started),
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        opacity: Number(cs.opacity),
        transform: cs.transform,
        move: box.getAnimations().filter(a => a.effect?.getKeyframes?.().some(k => 'transform' in k)).length,
      })
      if (performance.now() - started < duration)
        requestAnimationFrame(tick)
      else
        window.__sampling = false
    }
    requestAnimationFrame(tick)
  }, ms)
  await action()
  await page.waitForFunction(() => window.__sampling === false, { timeout: ms + 5000 })
  return page.evaluate(() => window.__samples)
}

/** The box's rect and the button's rect, for equality assertions. */
async function boxAndButton(page, buttonSelector) {
  return page.evaluate((selector) => {
    const box = document.querySelector('[data-dock-highlight]')
    const btn = document.querySelector(selector)
    if (!box || !btn)
      return null
    const b = box.getBoundingClientRect()
    const t = btn.getBoundingClientRect()
    return {
      box: { left: b.left, top: b.top, width: b.width, height: b.height, opacity: Number(getComputedStyle(box).opacity) },
      button: { left: t.left, top: t.top, width: t.width, height: t.height },
      buttonBg: getComputedStyle(btn).backgroundColor,
    }
  }, buttonSelector)
}

function near(a, b, eps = 1) {
  return Math.abs(a - b) <= eps
}

function assertAt(measured, message) {
  assert(measured, message)
  assert(near(measured.box.left, measured.button.left) && near(measured.box.top, measured.button.top), `${message} (box ${measured.box.left},${measured.box.top} vs button ${measured.button.left},${measured.button.top})`)
  assert(near(measured.box.width, measured.button.width) && near(measured.box.height, measured.button.height), `${message} (size ${measured.box.width}x${measured.box.height} vs ${measured.button.width}x${measured.button.height})`)
}

/** A stage point that is not a pane, sticker, label, button or the dock. */
async function stageMarginPoint(page) {
  return page.evaluate(() => {
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

async function panelKeys(page) {
  return page.locator('[data-dock-popover-panel]').evaluateAll(els => els.map(e => e.getAttribute('data-dock-popover-panel')))
}

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })

try {
  // ---------------------------------------------------------------- first checks
  {
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 375, height: 812 } })).newPage()
    await gotoWithRetry(page)
    await openStage(page)

    const open = await page.evaluate(() => {
      const scroller = document.querySelector('[data-dock-fade]')
      const trigger = document.querySelector('button[data-dock-popover="split"]')
      scroller.scrollLeft = 120
      const before = scroller.scrollLeft
      trigger.click()
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          const t = document.querySelector('button[data-dock-popover="split"]')
          const popup = document.querySelector('[data-dock-popover-panel="split"]')
          const tr = t.getBoundingClientRect()
          const pr = popup?.getBoundingClientRect()
          resolve({
            open: t.hasAttribute('data-popup-open'),
            expanded: t.getAttribute('aria-expanded'),
            popup: !!popup,
            guardsBeside: [...document.querySelectorAll('[data-base-ui-focus-guard]')].filter(g => g.parentElement === t.parentElement).length,
            gapAbove: pr ? Math.round(tr.top - pr.bottom) : null,
            overlapsX: pr ? pr.right > tr.left && pr.left < tr.right : false,
            scrollable: scroller.scrollWidth > scroller.clientWidth,
            scrollBefore: before,
            scrollAfter: scroller.scrollLeft,
          })
        })
      })
    })
    console.log('first: open-commit', JSON.stringify(open))
    assert(open.open && open.expanded === 'true' && open.popup, 'the controlled open lands data-popup-open, aria-expanded and the panel in one commit')
    assert(open.guardsBeside === 4, `four focus guards park beside the trigger (saw ${open.guardsBeside})`)
    assert(open.gapAbove >= 0 && open.gapAbove <= 12 && open.overlapsX, 'the panel anchors above the trigger')
    assert(open.scrollable && open.scrollBefore === open.scrollAfter, `the guard-only skip keeps scrollLeft (${open.scrollBefore} -> ${open.scrollAfter})`)

    const closed = await page.evaluate(() => {
      const scroller = document.querySelector('[data-dock-fade]')
      const before = scroller.scrollLeft
      document.querySelector('button[data-dock-popover="split"]').click()
      return new Promise((resolve) => {
        setTimeout(() => resolve({
          panels: document.querySelectorAll('[data-dock-popover-panel]').length,
          guards: document.querySelectorAll('[data-base-ui-focus-guard]').length,
          scrollBefore: before,
          scrollAfter: scroller.scrollLeft,
        }), 400)
      })
    })
    console.log('first: close-commit', JSON.stringify(closed))
    assert(closed.panels === 0 && closed.guards === 0, 'the close removes the panel and its guards')
    assert(closed.scrollBefore === closed.scrollAfter, 'the close keeps scrollLeft')

    // `relative isolate` must be a no-op for every direct child's content box.
    const boxes = await page.evaluate(() => {
      const scroller = document.querySelector('[data-dock-fade]')
      const container = scroller.querySelector('[data-dock-context]')
      const read = () => [...container.children].map(h => ({
        tag: h.tagName,
        key: h.getAttribute('data-dock-tool') ?? (h.hasAttribute('data-label-dock') ? 'label-wrapper' : ''),
        x: h.offsetLeft - container.offsetLeft,
        y: h.offsetTop - container.offsetTop,
        w: h.offsetWidth,
        h: h.offsetHeight,
      }))
      const withRelative = read()
      scroller.classList.remove('relative')
      void scroller.offsetHeight
      const without = read()
      scroller.classList.add('relative')
      void scroller.offsetHeight
      return { withRelative, without }
    })
    assert(JSON.stringify(boxes.withRelative) === JSON.stringify(boxes.without), 'every direct child content box is unchanged by `relative`')
    console.log('first: content-boxes', boxes.withRelative.length, 'children identical with/without relative')

    await page.evaluate(() => {
      window.__collage.store().addLabel(0.5, 0.5)
    })
    await page.locator('button[data-dock-popover^="label-"]').first().waitFor({ state: 'visible', timeout: 10000 })
    await sleep(300)
    const label = await page.evaluate(() => {
      const scroller = document.querySelector('[data-dock-fade]')
      const container = scroller.querySelector('[data-dock-context]')
      const wrapper = container.querySelector('[data-label-dock]')
      const btn = wrapper.querySelector('button')
      const read = () => ({
        x: btn.offsetLeft - container.offsetLeft,
        y: btn.offsetTop - container.offsetTop,
        w: btn.offsetWidth,
        h: btn.offsetHeight,
        display: getComputedStyle(wrapper).display,
        offsetParent: btn.offsetParent === scroller ? 'scroller' : btn.offsetParent?.tagName,
      })
      const withRelative = read()
      scroller.classList.remove('relative')
      void scroller.offsetHeight
      const without = read()
      scroller.classList.add('relative')
      void scroller.offsetHeight
      return { withRelative, without }
    })
    console.log('first: label-button', JSON.stringify(label))
    assert(label.withRelative.display === 'contents', 'the label wrapper is display: contents')
    assert(label.withRelative.offsetParent === 'scroller' && label.without.offsetParent !== 'scroller', 'the label button offsetParent moves with `relative`')
    assert(label.withRelative.x === label.without.x && label.withRelative.y === label.without.y, 'the label button content box is unchanged')
    assert(label.withRelative.w === label.without.w && label.withRelative.h === label.without.h, 'the label button size is unchanged')
    await page.close()
  }

  // ------------------------------------------------------- 1/2/4/5/6/7: stage 1280
  {
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })).newPage()
    await gotoWithRetry(page)
    await openStage(page)

    // 1. Hover glide across two tools.
    await page.evaluate(() => {
      document.querySelector('[data-dock-fade]').scrollLeft = 0
    })
    const border = await centerOf(page, 'button[data-dock-popover="border"]')
    const split = await centerOf(page, 'button[data-dock-popover="split"]')
    assert(split.x > border.x + 40, 'the two glide tools must be apart on x')
    await page.mouse.move(border.x, border.y)
    await sleep(250)
    const atBorder = await boxAndButton(page, 'button[data-dock-popover="border"]')
    assert(atBorder.box.opacity === 1, 'the box is shown over the first tool')
    assertAt(atBorder, 'the box sits on the hovered Border tool')

    const glide = await sample(page, 240, async () => {
      await page.mouse.move(split.x, split.y)
    })
    const atSplit = await boxAndButton(page, 'button[data-dock-popover="split"]')
    assert(atSplit.buttonBg === 'rgba(0, 0, 0, 0)', `the hovered tool paints no background of its own (${atSplit.buttonBg})`)
    assertAt(atSplit, 'the box lands on the hovered Split tool')
    const between = glide.filter(s => s.left > Math.min(atBorder.box.left, atSplit.box.left) + 1 && s.left < Math.max(atBorder.box.left, atSplit.box.left) - 1)
    const last = glide.at(-1)
    console.log('1: glide samples', JSON.stringify({ mid: between.length, first: glide[0], last, from: atBorder.box.left, to: atSplit.box.left }))
    assert(between.length > 0, 'a mid-glide sample lies strictly between the two tools')
    assert(near(last.left, atSplit.box.left) && near(last.top, atSplit.box.top), 'the glide finishes on the target')

    // 2. First appearance: hidden, then on the target in the first visible frame.
    await page.mouse.move(640, 300)
    await sleep(300)
    const hidden = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-dock-highlight]')).opacity))
    assert(hidden === 0, `the box hides when the pointer leaves the dock (opacity ${hidden})`)
    const appear = await sample(page, 200, async () => {
      await page.mouse.move(border.x, border.y)
    })
    const visibleFrames = appear.filter(s => s.opacity > 0)
    const firstVisible = visibleFrames[0]
    console.log('2: appearance', JSON.stringify({ firstVisible, transformAnims: firstVisible?.move, lastOpacity: appear.at(-1)?.opacity }))
    assert(firstVisible, 'the box becomes visible on a frame')
    assert(near(firstVisible.left, atBorder.button.left) && near(firstVisible.top, atBorder.button.top), 'the first visible frame is already on the target')
    assert(firstVisible.move === 0, 'the first appearance runs no transform animation')
    assert(firstVisible.opacity < 1, 'the first appearance fades in')
    assert(appear.at(-1).opacity === 1, 'the fade reaches full opacity')

    // 4. Retention: click Split open, leave the dock, hover a plain action.
    await page.mouse.click(split.x, split.y)
    await sleep(300)
    assert((await panelKeys(page)).includes('split'), 'the Split panel is open after its click')
    await page.mouse.move(640, 300)
    await sleep(300)
    assert((await panelKeys(page)).includes('split'), 'the panel stays when the pointer leaves the dock')
    const sticker = await page.locator('button[data-dock-tool="Sticker"]').first().boundingBox()
    assert(sticker, 'a plain Sticker action must be in the row')
    await page.mouse.move(sticker.x + sticker.width / 2, sticker.y + sticker.height / 2)
    await sleep(250)
    assert((await panelKeys(page)).includes('split'), 'the panel stays while a plain action is hovered')
    const atSticker = await boxAndButton(page, 'button[data-dock-tool="Sticker"]')
    assertAt(atSticker, 'the box moves to the plain action')
    console.log('4: retention ok, box on Sticker', JSON.stringify(atSticker.box))

    // 5. Nothing open: hover across popover triggers, then stick.
    await page.keyboard.press('Escape')
    await sleep(350)
    assert((await panelKeys(page)).length === 0, 'Escape closes the retained panel')
    const modeBefore = await page.locator('[data-dock-mode]').getAttribute('data-dock-mode')
    for (const key of ['border', 'split', 'view']) {
      const c = await centerOf(page, `button[data-dock-popover="${key}"]`)
      await page.mouse.move(c.x, c.y)
      await sleep(120)
    }
    assert((await panelKeys(page)).length === 0, 'hovering across triggers with nothing open mounts no panel')
    await page.mouse.move(border.x, border.y)
    await sleep(150)
    await page.mouse.click(border.x, border.y)
    await sleep(250)
    assert((await panelKeys(page)).includes('border'), 'a click opens the Border panel')
    await page.mouse.move(split.x, split.y)
    await sleep(300)
    assert((await panelKeys(page)).join() === 'split', 'the hover hands the panel over to Split')
    await page.mouse.click(split.x, split.y)
    await sleep(300)
    assert((await panelKeys(page)).join() === 'split', 'the first click on a hover-opened trigger keeps it open (stick)')
    await page.mouse.click(split.x, split.y)
    await sleep(300)
    assert((await panelKeys(page)).length === 0, 'the second click closes it')
    const modeAfter = await page.locator('[data-dock-mode]').getAttribute('data-dock-mode')
    assert(modeBefore === modeAfter, 'Escape and the clicks never collapse the dock display')
    console.log('5: nothing-open, stick and Escape ok; mode', modeAfter)

    // 6. Scroll: the box rides the content by the same delta.
    await page.mouse.move(border.x, border.y)
    await sleep(200)
    const scroll = await page.evaluate(() => {
      const scroller = document.querySelector('[data-dock-fade]')
      const box = document.querySelector('[data-dock-highlight]')
      const btn = document.querySelector('button[data-dock-popover="border"]')
      const read = () => ({ box: box.getBoundingClientRect().left, btn: btn.getBoundingClientRect().left })
      scroller.scrollLeft = 0
      void scroller.offsetHeight
      const before = read()
      scroller.scrollLeft = 80
      void scroller.offsetHeight
      const after = read()
      return { before, after, scrollable: scroller.scrollWidth > scroller.clientWidth }
    })
    console.log('6: scroll-x', JSON.stringify(scroll))
    assert(scroll.scrollable, 'the row must scroll for the scroll check')
    assert(near(scroll.before.box - scroll.after.box, scroll.before.btn - scroll.after.btn, 0.5), 'the box and the button shift by the same scroll delta')
    assert(scroll.before.box !== scroll.after.box, 'the scroll actually moved the box')

    // 7. Issue #76: open Filter, deselect the pane, refocus.
    await page.evaluate(() => {
      document.querySelector('[data-dock-fade]').scrollLeft = 0
    })
    const filter = await centerOf(page, 'button[data-dock-filter]')
    await page.mouse.click(filter.x, filter.y)
    await sleep(400)
    assert((await panelKeys(page)).includes('filter'), 'the Filter panel opens')
    const margin = await stageMarginPoint(page)
    assert(margin, 'a stage margin point must exist')
    await page.mouse.click(margin.x, margin.y)
    await sleep(500)
    assert(await page.locator('button[data-dock-filter]').count() === 0, 'the stage press unmounts the Filter tool')
    assert((await panelKeys(page)).length === 0, 'no portalled panel survives the hide gate')
    const img = await page.locator('img').first().boundingBox()
    await page.mouse.click(img.x + img.width / 2, img.y + img.height / 2)
    await page.locator('button[data-dock-filter]').waitFor({ state: 'visible', timeout: 10000 })
    await sleep(400)
    assert(await page.locator('button[data-dock-filter]').getAttribute('aria-expanded') !== 'true', 'the refocused Filter reads collapsed')
    assert((await panelKeys(page)).length === 0, 'no panel resurrects on refocus (issue #76)')
    console.log('7: issue #76 ok')
    await page.close()
  }

  // ----------------------------------------------------- 3: hand-over on the grid
  {
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })).newPage()
    await gotoWithRetry(page)
    await openGrid(page)
    const scrolled = await page.evaluate(() => {
      const scroller = document.querySelector('[data-dock-fade]')
      scroller.scrollLeft = 80
      return { scrollable: scroller.scrollWidth > scroller.clientWidth, left: scroller.scrollLeft }
    })
    assert(scrolled.scrollable && scrolled.left === 80, 'the grid row must scroll and hold 80px')
    await page.evaluate(() => document.querySelector('button[data-dock-popover="border"]').click())
    await sleep(300)
    assert((await panelKeys(page)).join() === 'border', 'the Border panel opens')
    const grid = await centerOf(page, 'button[data-dock-popover="grid"]')
    await page.mouse.move(grid.x, grid.y)
    await sleep(350)
    const handover = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('[data-dock-popover-panel]')]
      const popup = panels[0]
      const grid = document.querySelector('button[data-dock-popover="grid"]')
      const border = document.querySelector('button[data-dock-popover="border"]')
      const p = popup.getBoundingClientRect()
      const t = grid.getBoundingClientRect()
      const active = document.activeElement
      return {
        panels: panels.map(n => n.getAttribute('data-dock-popover-panel')),
        gridOpen: grid.hasAttribute('data-popup-open'),
        borderOpen: border.hasAttribute('data-popup-open'),
        gridBg: getComputedStyle(grid).backgroundColor,
        gridShadow: getComputedStyle(grid).boxShadow,
        borderBg: getComputedStyle(border).backgroundColor,
        popupAnimation: getComputedStyle(popup).animationName,
        popupTransition: getComputedStyle(popup).transitionProperty,
        popupOpacity: getComputedStyle(popup).opacity,
        popupScale: getComputedStyle(popup).scale,
        popupTranslate: getComputedStyle(popup).translate,
        hopAttr: popup.hasAttribute('data-dock-hop'),
        hopX: getComputedStyle(popup).getPropertyValue('--dock-hop-x').trim(),
        hopY: getComputedStyle(popup).getPropertyValue('--dock-hop-y').trim(),
        popupBottom: p.bottom,
        triggerTop: t.top,
        overlapsX: p.left < t.right && p.right > t.left,
        activeInside: !!(active && active.closest('[data-dock-popover-panel]')),
        scrollLeft: document.querySelector('[data-dock-fade]').scrollLeft,
        popupRect: [Math.round(p.left), Math.round(p.top), Math.round(p.width), Math.round(p.height)],
        triggerRect: [Math.round(t.left), Math.round(t.top), Math.round(t.width), Math.round(t.height)],
      }
    })
    console.log('3: hand-over', JSON.stringify(handover))
    assert(handover.panels.length === 1 && handover.panels[0] === 'grid', `exactly the Grid panel is mounted (${handover.panels})`)
    assert(handover.gridOpen && !handover.borderOpen, 'only the Grid trigger reads open')
    assert(handover.gridBg !== 'rgba(0, 0, 0, 0)' && handover.borderBg === 'rgba(0, 0, 0, 0)', 'the open trigger keeps its chip-on fill and the outgoing one is plain')
    assert(handover.gridShadow.includes('inset'), `the open trigger keeps its inset accent (${handover.gridShadow})`)
    assert(handover.popupAnimation.includes('dock-hop'), `the incoming panel runs the hop keyframes (${handover.popupAnimation})`)
    assert(handover.popupTransition === 'none', `the hop replaces the starting-style transition (${handover.popupTransition})`)
    assert(handover.popupOpacity === '1' && handover.popupScale === 'none' && handover.popupTranslate === 'none', 'the starting-style frame does not stick after the hop')
    assert(handover.hopAttr && Number.parseFloat(handover.hopX) !== 0, `the incoming panel carries a non-zero hop (${handover.hopX})`)
    assert(handover.popupBottom <= handover.triggerTop + 1 && handover.overlapsX, 'the incoming panel anchors above its own trigger')
    assert(!handover.activeInside, 'the hand-over does not focus the panel')
    assert(handover.scrollLeft === 80, `the hand-over never clamps the row scroll (${handover.scrollLeft})`)

    // A route swap still ghosts and slides: the guard-only skip must not have
    // changed the real child-list path.
    await page.keyboard.press('Escape')
    await sleep(300)
    await page.evaluate(() => {
      window.__sawGhost = false
      window.__sawSwapTransform = false
      const started = performance.now()
      const tick = () => {
        if (document.querySelector('[data-dock-swap-ghost]'))
          window.__sawGhost = true
        const scroller = document.querySelector('[data-dock-fade]')
        if (scroller && scroller.style.transform)
          window.__sawSwapTransform = true
        if (performance.now() - started < 900)
          requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.evaluate(() => {
      location.hash = `#/w/${window.__collage.store().activeId}`
    })
    await sleep(1200)
    const swap = await page.evaluate(() => ({ ghost: window.__sawGhost, transform: window.__sawSwapTransform }))
    console.log('3b: route swap', JSON.stringify(swap))
    assert(swap.ghost && swap.transform, 'a route swap still ghosts and slides the outgoing list')
    await page.close()
  }

  // ------------------------------------------------- 6 (vertical) and 8: 375x812
  {
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 375, height: 812 } })).newPage()
    await gotoWithRetry(page)
    await openStage(page)
    await page.evaluate(() => {
      window.__collage.store().setToolsDockMode('expanded')
    })
    await page.waitForFunction(() => document.querySelector('[data-dock-mode]')?.getAttribute('data-dock-mode') === 'expanded')
    await sleep(600)
    const firstTool = page.locator('[data-dock-context] button[data-dock-tool]').first()
    const toolBox = await firstTool.boundingBox()
    assert(toolBox, 'a wrapped tool must be visible')
    await page.mouse.move(toolBox.x + toolBox.width / 2, toolBox.y + toolBox.height / 2)
    await sleep(250)
    const vscroll = await page.evaluate(() => {
      const scroller = document.querySelector('[data-dock-fade]')
      const box = document.querySelector('[data-dock-highlight]')
      const btn = document.querySelector('[data-dock-context] button[data-dock-tool]')
      const read = () => ({ box: box.getBoundingClientRect().top, btn: btn.getBoundingClientRect().top })
      const before = read()
      scroller.scrollTop = 40
      void scroller.offsetHeight
      const after = read()
      return { before, after, scrollable: scroller.scrollHeight > scroller.clientHeight, scrollTop: scroller.scrollTop }
    })
    console.log('6: scroll-y', JSON.stringify(vscroll))
    assert(vscroll.scrollable && vscroll.scrollTop > 0, 'the wrapped list must scroll vertically')
    assert(near(vscroll.before.box - vscroll.after.box, vscroll.before.btn - vscroll.after.btn, 0.5), 'the box and the button shift by the same vertical delta')
    await page.close()
  }

  // ------------------------------------------------------------ 8: touch 375x812
  {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } })
    const page = await context.newPage()
    await gotoWithRetry(page)
    await openStage(page)
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    assert(coarse, 'the touch context must report a coarse pointer')
    const cdp = await context.newCDPSession(page)
    const border = await centerOf(page, 'button[data-dock-popover="border"]')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: border.x, y: border.y }] })
    await sleep(120)
    const pressed = await page.evaluate(() => {
      const box = document.querySelector('[data-dock-highlight]')
      const btn = document.querySelector('button[data-dock-popover="border"]')
      const b = box.getBoundingClientRect()
      const t = btn.getBoundingClientRect()
      return { box: [b.left, b.top, b.width, b.height], trigger: [t.left, t.top, t.width, t.height], opacity: Number(getComputedStyle(box).opacity) }
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    console.log('8: touch press', JSON.stringify(pressed))
    assert(pressed.opacity > 0.5, `a touch press shows the box under the finger (opacity ${pressed.opacity})`)
    assert(near(pressed.box[0], pressed.trigger[0]) && near(pressed.box[1], pressed.trigger[1]) && near(pressed.box[2], pressed.trigger[2]), 'the touch box sits on the pressed tool')
    await sleep(400)
    assert((await panelKeys(page)).includes('border'), 'the touch tap opens the Border panel')
    // A touch pointerover on another trigger must not hand over.
    const handOver = await page.evaluate(() => {
      const filter = document.querySelector('button[data-dock-filter]')
      filter.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }))
      return new Promise((resolve) => {
        requestAnimationFrame(() => resolve({
          panels: [...document.querySelectorAll('[data-dock-popover-panel]')].map(n => n.getAttribute('data-dock-popover-panel')),
          filterOpen: filter.hasAttribute('data-popup-open'),
        }))
      })
    })
    console.log('8: touch pointerover', JSON.stringify(handOver))
    assert(handOver.panels.join() === 'border' && !handOver.filterOpen, 'a touch pointerover does not hand the panel over')
    await page.screenshot({ path: `${OUT}/touch-open-375x812.png` })
    const touchGeo = await page.evaluate(() => {
      const popup = document.querySelector('[data-dock-popover-panel="border"]')
      const trigger = document.querySelector('button[data-dock-popover="border"]')
      const p = popup.getBoundingClientRect()
      const t = trigger.getBoundingClientRect()
      return { popup: [Math.round(p.left), Math.round(p.top), Math.round(p.width), Math.round(p.height)], trigger: [Math.round(t.left), Math.round(t.top), Math.round(t.width), Math.round(t.height)] }
    })
    console.log('8: touch-open rects', JSON.stringify(touchGeo))
    await page.close()
  }

  // ------------------------------------------------------------- 9: reduced motion
  {
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } })).newPage()
    await gotoWithRetry(page)
    await openStage(page)
    await page.mouse.move(640, 300)
    await sleep(300)
    const border = await centerOf(page, 'button[data-dock-popover="border"]')
    const split = await centerOf(page, 'button[data-dock-popover="split"]')
    await page.mouse.move(border.x, border.y)
    await sleep(200)
    const frames = await sample(page, 180, async () => {
      await page.mouse.move(split.x, split.y)
    })
    const final = await boxAndButton(page, 'button[data-dock-popover="split"]')
    const last = frames.at(-1)
    console.log('9: reduced-motion', JSON.stringify({ last, transformAnims: frames.reduce((n, f) => n + f.move, 0) }))
    assert(frames.reduce((n, f) => n + f.move, 0) === 0, 'reduced motion runs no transform animation on the box')
    assert(last.transform === 'none', `the reduced-motion placement has no transform (${last.transform})`)
    assert(near(last.left, final.button.left) && near(last.top, final.button.top), 'the reduced-motion box is final on the next frame')
    await page.close()
  }

  // ------------------------------------------------------------------ 10: screenshots
  for (const [width, height] of [[375, 812], [1280, 900], [1280, 600], [915, 412]]) {
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } })).newPage()
    await gotoWithRetry(page)
    await seedPhoto(page)
    await page.evaluate(() => {
      location.hash = `#/w/${window.__collage.store().activeId}`
    })
    await page.locator('img').first().waitFor({ state: 'visible', timeout: 20000 })
    await sleep(500)
    const img = await page.locator('img').first().boundingBox()
    await page.mouse.click(img.x + img.width / 2, img.y + img.height / 2)
    await page.locator('button[data-dock-popover="border"]').waitFor({ state: 'visible', timeout: 15000 })
    await sleep(400)
    const border = await centerOf(page, 'button[data-dock-popover="border"]')
    await page.mouse.move(border.x, border.y)
    await sleep(250)
    const measured = await boxAndButton(page, 'button[data-dock-popover="border"]')
    const path = `${OUT}/hover-${width}x${height}.png`
    await page.screenshot({ path })
    console.log(`10: ${path}`, JSON.stringify({ box: measured.box, button: measured.button }))
    assertAt(measured, `the ${width}x${height} hover box sits on Border`)
    await page.close()
  }
}
finally {
  await browser.close()
  server?.kill('SIGTERM')
}

console.log('dock glide check passed')
