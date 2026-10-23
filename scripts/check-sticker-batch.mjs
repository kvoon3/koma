/**
 * Browser evidence for the sticker batch: the camera source, the texture's
 * pixel identity, and the maker screenshots the vision review reads.
 *
 * Playwright-core and the cached Chromium are local tools, not dependencies, so
 * this runs by hand against the dev server:
 *   bun run dev -- --port 5199 --strictPort
 *   bun scripts/check-sticker-batch.mjs
 *
 * The fake device and the auto-accepted prompt make getUserMedia resolve to a
 * live video track without a physical camera.
 */
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

const BASE = process.env.STICKER_BASE ?? 'https://localhost:5199'
const OUT = process.env.STICKER_SHOTS ?? '/tmp/sticker-batch-shots'
const CHROMIUM = process.env.CHROMIUM_PATH ?? findChromium()
mkdirSync(OUT, { recursive: true })

function findChromium() {
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  const dirs = readdirSync(root)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    const path = join(root, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(path))
      return path
  }
  throw new Error('Set CHROMIUM_PATH: no cached Chromium under ms-playwright')
}

function assert(condition, message) {
  if (!condition)
    throw new Error(message)
}

async function newPage(browser, viewport, init) {
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, permissions: ['camera'] })
  if (init)
    await context.addInitScript(init)
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource'))
      console.error('[page]', message.text())
  })
  await page.goto(`${BASE}/#/library?type=sticker`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-library-new-sticker]')
  return { context, page }
}

async function openMaker(page) {
  await page.click('[data-library-new-sticker]')
  await page.waitForSelector('[data-sticker-maker="new"]')
}

async function openCamera(page) {
  await page.click('[data-camera-open]')
  await page.waitForSelector('[data-camera-panel]')
}

async function setPaperTexture(page, value) {
  const slider = page.getByRole('slider', { name: 'Paper texture' })
  await slider.focus()
  await slider.press('Home')
  for (let step = 0; step < value; step += 1)
    await slider.press('ArrowRight')
  await page.waitForSelector(`[data-sticker-texture="${value}"]`)
}

async function texturePixels(page) {
  return page.evaluate(async () => {
    const sticker = window.__collage.sticker
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 120
    const context = canvas.getContext('2d')
    const gradient = context.createLinearGradient(0, 0, 160, 120)
    gradient.addColorStop(0, '#204080')
    gradient.addColorStop(1, '#d08030')
    context.fillStyle = gradient
    context.fillRect(0, 0, 160, 120)
    context.clearRect(40, 30, 50, 40)
    const src = canvas.toDataURL('image/png')
    const base = { type: 'image', src }

    const off = await sticker.makeSticker(base, { maxEdge: 480, texture: null })
    const zero = await sticker.makeSticker(base, { maxEdge: 480, texture: { strength: 0 } })
    const on = await sticker.makeSticker(base, { maxEdge: 480, texture: { strength: 60 } })
    const save = await sticker.makeSticker(base, { maxEdge: 960, texture: { strength: 60 } })

    async function pixelsOf(dataUrl) {
      const image = new Image()
      image.src = dataUrl
      await image.decode()
      const local = document.createElement('canvas')
      local.width = image.naturalWidth
      local.height = image.naturalHeight
      const localContext = local.getContext('2d')
      localContext.drawImage(image, 0, 0)
      return localContext.getImageData(0, 0, local.width, local.height)
    }

    const a = await pixelsOf(off.dataUrl)
    const b = await pixelsOf(on.dataUrl)
    const c = await pixelsOf(save.dataUrl)
    let alphaDiff = 0
    let rgbDiff = 0
    let deltaSum = 0
    let deltaSquares = 0
    const channels = a.data.length / 4 * 3
    for (let index = 0; index < a.data.length; index += 4) {
      if (a.data[index + 3] !== b.data[index + 3])
        alphaDiff += 1
      const delta = b.data[index] - a.data[index]
      if (delta !== 0 || b.data[index + 1] !== a.data[index + 1] || b.data[index + 2] !== a.data[index + 2])
        rgbDiff += 1
      deltaSum += Math.abs(delta)
      deltaSquares += delta * delta
    }

    const scaled = document.createElement('canvas')
    scaled.width = 480
    scaled.height = 480 * c.height / c.width
    const scaledContext = scaled.getContext('2d')
    scaledContext.imageSmoothingEnabled = true
    scaledContext.imageSmoothingQuality = 'high'
    const saveImage = new Image()
    saveImage.src = save.dataUrl
    await saveImage.decode()
    scaledContext.drawImage(saveImage, 0, 0, scaled.width, scaled.height)
    const down = scaledContext.getImageData(0, 0, scaled.width, scaled.height)
    const previewImage = new Image()
    previewImage.src = on.dataUrl
    await previewImage.decode()
    const preview = document.createElement('canvas')
    preview.width = previewImage.naturalWidth
    preview.height = previewImage.naturalHeight
    const previewContext = preview.getContext('2d')
    previewContext.drawImage(previewImage, 0, 0)
    const previewData = previewContext.getImageData(0, 0, preview.width, preview.height)
    const width = Math.min(preview.width, down.width)
    const height = Math.min(preview.height, down.height)
    let paritySum = 0
    let parityCount = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = (y * preview.width + x) * 4
        const d = (y * down.width + x) * 4
        for (let channel = 0; channel < 3; channel += 1) {
          paritySum += Math.abs(previewData.data[p + channel] - down.data[d + channel])
          parityCount += 1
        }
      }
    }

    return {
      zeroIdentical: off.dataUrl === zero.dataUrl,
      dimensions: [a.width, a.height, b.width, b.height],
      alphaDiff,
      rgbDiff,
      meanDelta: deltaSum / channels,
      deltaStd: Math.sqrt(deltaSquares / channels),
      parityMeanDelta: paritySum / parityCount,
    }
  })
}

const report = {}
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})

try {
  const initStreams = () => {
    const media = navigator.mediaDevices
    if (!media)
      return
    const original = media.getUserMedia.bind(media)
    window.__cameraStreams = []
    media.getUserMedia = async (...args) => {
      const stream = await original(...args)
      window.__cameraStreams.push(stream)
      return stream
    }
  }

  {
    const { context, page } = await newPage(browser, { width: 1280, height: 900 }, initStreams)
    await openMaker(page)
    report.texture = await texturePixels(page)

    await openCamera(page)
    await page.waitForSelector('[data-camera-panel][data-camera-state="ready"]', { timeout: 20000 })
    report.cameraLive = await page.evaluate(() => {
      const video = document.querySelector('[data-camera-preview]')
      const stream = video.srcObject
      const tracks = stream ? stream.getVideoTracks() : []
      return {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        tracks: tracks.length,
        trackState: tracks[0]?.readyState ?? null,
      }
    })
    await page.screenshot({ path: join(OUT, 'camera-live-1280x900.png') })

    await page.click('[data-camera-capture]')
    await page.waitForSelector('[data-camera-panel]', { state: 'detached' })
    await page.waitForSelector('[data-sticker-stage="cuttingOut"], [data-sticker-stage="ready"]')
    report.afterCapture = await page.evaluate(() => ({
      stage: document.querySelector('[data-sticker-stage]')?.getAttribute('data-sticker-stage'),
      img: document.querySelector('[data-sticker-stage] img')?.getAttribute('src')?.slice(0, 5) ?? null,
    }))
    await page.waitForSelector('[data-sticker-save]:not([disabled])', { timeout: 120000 })
    await page.screenshot({ path: join(OUT, 'camera-captured-1280x900.png') })

    report.streamsEnded = await page.evaluate(() => window.__cameraStreams.map(stream => stream.getTracks().every(track => track.readyState === 'ended')))
    await page.click('[data-sticker-save]')
    await page.waitForSelector('[data-sticker-maker]', { state: 'detached' })
    report.saved = await page.evaluate(() => {
      const photos = window.__collage.store().photos
      const made = photos.find(photo => photo.kind === 'sticker' && photo.recipe?.original?.type === 'image' && photo.recipe.original.name.startsWith('camera-'))
      return made
        ? {
            kind: made.kind,
            name: made.name,
            originalName: made.recipe.original.name,
            texture: made.recipe.style.texture,
            width: made.trueW,
            height: made.trueH,
          }
        : null
    })

    await openMaker(page)
    await openCamera(page)
    await page.waitForSelector('[data-camera-panel][data-camera-state="ready"]', { timeout: 20000 })
    await page.click('[data-camera-cancel]')
    await page.waitForSelector('[data-camera-panel]', { state: 'detached' })
    report.cancelEnded = await page.evaluate(() => window.__cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))

    await openCamera(page)
    await page.waitForSelector('[data-camera-panel][data-camera-state="ready"]', { timeout: 20000 })
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-sticker-maker]', { state: 'detached' })
    report.closeEnded = await page.evaluate(() => window.__cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))
    await openMaker(page)
    report.reopenHasCamera = await page.locator('[data-camera-panel]').count()
    await context.close()
  }

  {
    const { context, page } = await newPage(browser, { width: 1280, height: 900 }, initStreams)
    const workspaceId = await page.evaluate(() => window.__collage.store().activeId)
    await page.evaluate((id) => {
      location.hash = `#/w/${id}`
    }, workspaceId)
    await page.waitForSelector('[data-canvas-view]')
    await page.evaluate(() => {
      const store = window.__collage.store()
      const workspace = store.workspaces.find(item => item.id === store.activeId)
      const leaf = window.__collage.panes.leafList(workspace.root)[0]
      store.openStickerMaker(leaf.id)
    })
    await page.waitForSelector('[data-sticker-maker="new"]')
    await openCamera(page)
    await page.waitForSelector('[data-camera-panel][data-camera-state="ready"]', { timeout: 20000 })
    await page.click('[data-camera-capture]')
    await page.waitForSelector('[data-sticker-save]:not([disabled])', { timeout: 120000 })
    await page.click('[data-sticker-save]')
    await page.waitForSelector('[data-sticker-maker]', { state: 'detached' })
    report.boardInserted = await page.evaluate(() => {
      const store = window.__collage.store()
      const workspace = store.workspaces.find(item => item.id === store.activeId)
      const sticker = workspace.stickers.at(-1)
      const photo = sticker && store.photos.find(item => item.id === sticker.photoId)
      return {
        stickers: workspace.stickers.length,
        kind: photo?.kind ?? null,
        originalName: photo?.recipe?.original?.name ?? null,
      }
    })
    await context.close()
  }

  {
    const { context, page } = await newPage(browser, { width: 1280, height: 900 })
    await openMaker(page)

    const exportPng = await page.evaluate(async () => {
      const res = await window.__collage.sticker.makeSticker(
        { type: 'text', text: 'Wrinkled', color: '#111111', fontFamily: 'Georgia, serif', fontWeight: 700 },
        { maxEdge: 960, texture: { strength: 100 }, outlineWidth: 18, outlineColor: '#ffffff', displayLongEdge: 220 },
      )
      return res.dataUrl
    })
    writeFileSync(join(OUT, 'texture-export.png'), Buffer.from(exportPng.split(',')[1], 'base64'))

    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.fill('textarea', 'Wrinkled paper')
    await setPaperTexture(page, 100)
    await page.waitForTimeout(900)
    await page.click('[data-sticker-save]')
    await page.waitForSelector('[data-sticker-maker]', { state: 'detached' })
    report.textureSaved = await page.evaluate(() => {
      const photo = window.__collage.store().photos.find(p => p.kind === 'sticker' && p.name.startsWith('Wrinkled'))
      return photo ? { texture: photo.recipe?.style.texture, name: photo.name } : null
    })

    await openMaker(page)
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.fill('textarea', 'Wrinkled paper')
    await setPaperTexture(page, 100)
    await page.waitForTimeout(900)
    for (const [width, height] of [[375, 812], [1280, 900], [1280, 600], [915, 412]]) {
      await page.setViewportSize({ width, height })
      await page.locator('[data-sticker-stage]').scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(OUT, `texture-${width}x${height}-preview.png`) })
      await page.locator('[data-sticker-texture]').scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(OUT, `texture-${width}x${height}-control.png`) })
    }
    await context.close()
  }

  {
    const denied = () => {
      if (!navigator.mediaDevices)
        return
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      })
    }
    const { context, page } = await newPage(browser, { width: 1280, height: 900 }, denied)
    await openMaker(page)
    await openCamera(page)
    await page.waitForSelector('[data-camera-error="denied"]', { timeout: 10000 })
    report.denied = await page.evaluate(() => ({
      code: document.querySelector('[data-camera-error]')?.getAttribute('data-camera-error'),
      text: document.querySelector('[data-camera-error]')?.textContent?.trim() ?? '',
      retry: !!document.querySelector('[data-camera-retry]'),
    }))
    await page.click('[data-camera-cancel]')
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.fill('textarea', 'Still works')
    await page.waitForTimeout(400)
    report.deniedStillUsable = await page.locator('[data-sticker-save]:not([disabled])').count() === 1
    await context.close()
  }

  {
    const missing = () => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    }
    const { context, page } = await newPage(browser, { width: 1280, height: 900 }, missing)
    await openMaker(page)
    await openCamera(page)
    await page.waitForSelector('[data-camera-error="unsupported"]', { timeout: 10000 })
    report.unsupported = await page.evaluate(() => document.querySelector('[data-camera-error]')?.textContent?.trim() ?? '')
    await context.close()
  }
}
finally {
  await browser.close()
}

writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))

assert(report.texture.zeroIdentical, 'strength 0 must equal no texture')
assert(report.texture.alphaDiff === 0, 'texture must not change alpha')
assert(report.texture.rgbDiff > 0, 'texture must change RGB')
assert(report.cameraLive.tracks === 1 && report.cameraLive.videoWidth > 0, 'camera must show a live frame')
assert(report.afterCapture.stage !== 'empty', 'capture must fill the source slot')
assert(report.boardInserted?.stickers >= 1 && report.boardInserted?.kind === 'sticker', 'a capture on the board must insert a sticker')
assert(report.saved?.kind === 'sticker' && report.saved?.originalName.startsWith('camera-'), 'capture must save a re-editable sticker')
assert(report.streamsEnded.every(Boolean), 'capture must stop every track')
assert(report.cancelEnded, 'cancel must stop every track')
assert(report.closeEnded, 'close must stop every track')
assert(report.reopenHasCamera === 0, 'reopen must not show a dead camera panel')
assert(report.textureSaved?.texture?.strength === 100, 'the recipe must keep the texture strength')
assert(report.denied.code === 'denied' && report.denied.text.length > 0 && report.denied.retry, 'denial must explain itself and offer Retry')
assert(report.deniedStillUsable, 'the maker must keep working after denial')
assert(report.unsupported.length > 0, 'a missing API must explain itself')
console.log('sticker batch browser checks passed')
