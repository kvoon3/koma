// Browser measurement for the NumberFlow surfaces: the view zoom chip, the
// scale rail readout, the rotation dial readout, the export zoom chip.
// Run with: PW_CHROMIUM=<chromium binary> bun scripts/measure-number-flow.ts <port>
import process from 'node:process'
import { chromium } from 'playwright-core'

interface CollageStore {
  addPhotos: (files: File[], autofill: boolean) => Promise<void>
  activeId: string
}

type FlowWindow = typeof window & {
  __collage: { store: () => CollageStore }
  __stageEl: Element
}

type FlowEl = ({ _data?: { valueAsString?: string } } & Element) | null

const port = process.argv[2] ?? '5211'
const exe = process.env.PW_CHROMIUM
const url = `https://127.0.0.1:${port}/`

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true })
await page.goto(url, { waitUntil: 'networkidle' })

// Seed one photo so the board has a pane.
await page.evaluate(async () => {
  const store = (window as FlowWindow).__collage.store()
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#268bd2'
  ctx.fillRect(0, 0, 400, 300)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  const file = new File([blob!], 'seed.png', { type: 'image/png' })
  await store.addPhotos([file], true)
})
await page.waitForTimeout(300)

// The wheel listener lives on the stage-checker wrap; dispatch from there so
// the event's target is the wrap itself (the canvas guard never trips).
// Seed lands on the workspace grid; enter the workspace route so the Stage
// (with the rail and the dial) mounts.
await page.waitForTimeout(400)
const wsId = await page.evaluate(() => (window as FlowWindow).__collage.store().activeId)
await page.goto(`${url}#/w/${wsId}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
console.log('entered:', JSON.stringify(await page.evaluate(() => location.href)))
await page.evaluate(() => {
  ;(window as FlowWindow).__stageEl = document.querySelector('.stage-checker')!
})

// ctrl+wheel in, one notch every 4 frames, sampling the rendered value.
async function wheelBurst(dir: number, notches: number): Promise<(string | null)[]> {
  return page.evaluate(({ dir, notches }) => {
    const stage = (window as FlowWindow).__stageEl
    const read = (): string | null => {
      const flow = document.querySelector('[data-view-zoom-chip] number-flow-react') as FlowEl
      return flow ? (flow._data?.valueAsString ?? null) : null
    }
    return new Promise((resolve) => {
      const seen: (string | null)[] = []
      let frame = 0
      let sent = 0
      const tick = () => {
        seen.push(read())
        if (frame % 4 === 0 && sent < notches) {
          stage.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: dir * 120, bubbles: true, cancelable: true }))
          sent++
        }
        frame++
        if (sent >= notches && frame > sent * 4 + 12)
          resolve(seen)
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }, { dir, notches })
}

function distinct(vals: (string | null)[]): string[] {
  return [...new Set(vals.filter((v): v is string => !!v))]
}

// 1. View zoom chip: rolling values, style, then the fit fade-out.
const inVals = await wheelBurst(-1, 8)
console.log('zoom-in sampled values:', JSON.stringify(distinct(inVals)))

const chipStyle = await page.evaluate(() => {
  const chip = document.querySelector('[data-view-zoom-chip]')!
  const cs = getComputedStyle(chip)
  const r = chip.getBoundingClientRect()
  const flow = chip.querySelector('number-flow-react') as FlowEl
  return {
    bg: cs.backgroundColor,
    border: cs.borderTopWidth,
    weight: cs.fontWeight,
    text: flow?._data?.valueAsString,
    w: Math.round(r.width),
    h: Math.round(r.height),
    opacity: cs.opacity,
  }
})
console.log('chip style (must be bold, no bg, no border):', JSON.stringify(chipStyle))
await page.screenshot({ path: 'shots/nf-chip-3digit.png', clip: { x: 0, y: 0, width: 300, height: 140 } })

// Fit click: the digits roll home to 100% and the chip FADES out (still in the
// DOM, opacity animating, after the click lands).
const fade = await page.evaluate(() => {
  const chip = document.querySelector('[data-view-zoom-chip]') as HTMLElement | null
  if (!chip)
    return { clicked: false }
  chip.click()
  return { clicked: true }
})
await page.waitForTimeout(60)
const midFade = await page.evaluate(() => {
  const chip = document.querySelector('[data-view-zoom-chip]')
  if (!chip)
    return { stillInDom: false }
  const flow = chip.querySelector('number-flow-react') as FlowEl
  return {
    stillInDom: true,
    opacity: Number(getComputedStyle(chip).opacity).toFixed(2),
    value: flow?._data?.valueAsString ?? null,
    ariaHidden: chip.getAttribute('aria-hidden'),
  }
})
await page.waitForTimeout(500)
const afterFade = await page.evaluate(() => ({
  inDom: !!document.querySelector('[data-view-zoom-chip]'),
}))
console.log('fit click:', JSON.stringify(fade), 'mid-fade:', JSON.stringify(midFade), 'after:', JSON.stringify(afterFade))

// 2. Scale rail readout: focus the rail (its slider role sits next to the
//    [data-rail-value] span's parent), then arrow-key steps sample values.
const railVals = await page.evaluate(() => {
  const chip = document.querySelector('[data-rail-value]') as HTMLElement | null
  if (!chip) {
    return {
      rail: false,
      seen: [] as string[],
      dom: {
        cells: document.querySelectorAll('button[data-cell]').length,
        href: location.href,
        flows: document.querySelectorAll('number-flow-react').length,
      },
    }
  }
  const rail = chip.parentElement!.querySelector('[role="slider"]') ?? chip.closest('[role="slider"]')
  const slider = (rail ?? chip.parentElement!) as HTMLElement
  slider.focus()
  return new Promise<{ rail: boolean, seen: string[], dom?: Record<string, unknown> }>((resolve) => {
    const seen: string[] = []
    let n = 0
    const tick = () => {
      const flow = document.querySelector('[data-rail-value] number-flow-react') as FlowEl
      if (flow?._data?.valueAsString)
        seen.push(flow._data.valueAsString)
      if (n % 6 === 0 && n < 36)
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
      if (++n > 44)
        resolve({ rail: true, seen })
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
})
console.log('rail:', railVals === null ? 'null' : JSON.stringify(railVals))

// Rail pill style: full-round, white in light / black in dark, no border.
const railStyle = await page.evaluate(() => {
  const chip = document.querySelector('[data-rail-value]')
  if (!chip)
    return null
  const cs = getComputedStyle(chip)
  const r = chip.getBoundingClientRect()
  return {
    radius: cs.borderTopLeftRadius,
    bg: cs.backgroundColor,
    border: cs.borderTopWidth,
    weight: cs.fontWeight,
    w: Math.round(r.width),
    h: Math.round(r.height),
  }
})
console.log('rail pill style (light):', JSON.stringify(railStyle))
const darkPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, colorScheme: 'dark' })
await darkPage.goto(url, { waitUntil: 'networkidle' })
await darkPage.evaluate(async () => {
  const store = (window as FlowWindow).__collage.store()
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  canvas.getContext('2d')!.fillRect(0, 0, 400, 300)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  await store.addPhotos([new File([blob!], 'seed.png', { type: 'image/png' })], true)
})
await darkPage.waitForTimeout(400)
const mobIdD = await darkPage.evaluate(() => (window as FlowWindow).__collage.store().activeId)
await darkPage.goto(`${url}#/w/${mobIdD}`, { waitUntil: 'networkidle' })
await darkPage.waitForTimeout(700)
const railDark = await darkPage.evaluate(() => {
  const chip = document.querySelector('[data-rail-value]')
  return chip ? getComputedStyle(chip).backgroundColor : null
})
const htmlDark = await darkPage.evaluate(() => document.documentElement.classList.contains('dark'))
console.log('rail pill bg (dark page):', JSON.stringify(railDark), 'html.dark:', htmlDark)
await darkPage.close()

// 3. Rotation dial readout: tap the pane (a coordinate tap routes), open the
//    dock's Rotate popover, then read the rolling zero button.
const paneBox = await page.evaluate(() => {
  const img = document.querySelector('[data-pane-id] [data-photo-clip], [data-pane-id] img')
  const box = img?.getBoundingClientRect()
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
})
if (paneBox) {
  await page.mouse.click(paneBox.x, paneBox.y)
  await page.waitForTimeout(500)
}
const rotTrig = page.locator('[data-dock-tool]').filter({ hasText: /rotate|旋转/i }).first()
let rotReport: Record<string, unknown> | null = null
if (await rotTrig.count()) {
  await rotTrig.click()
  await page.waitForTimeout(500)
  rotReport = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('number-flow-react') && (b.title === 'Reset rotation' || b.getAttribute('aria-label') === 'Reset rotation'))
    if (!btn)
      return { found: false }
    const flow = btn.querySelector('number-flow-react') as FlowEl
    return { found: true, text: (flow?._data?.valueAsString ?? '').trim(), upgraded: !!flow?.shadowRoot && flow.shadowRoot.childElementCount > 0 }
  })
  // Drive the dial: ArrowRight on the focused slider samples rolling values.
  if (rotReport?.found) {
    const rotVals = await page.evaluate(() => {
      const slider = document.querySelector('[data-rotation-dial]') as HTMLElement | null
      if (!slider)
        return null
      slider.focus()
      return new Promise<string[]>((resolve) => {
        const seen: string[] = []
        let n = 0
        const tick = () => {
          const flow = [...document.querySelectorAll('button number-flow-react')].find(f => (f as FlowEl)?._data?.valueAsString?.includes('°')) as FlowEl | undefined
          if (flow?._data?.valueAsString)
            seen.push(flow._data.valueAsString)
          if (n % 6 === 0 && n < 36)
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
          if (++n > 44)
            resolve(seen)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    })
    rotReport.values = rotVals === null ? 'dial not found' : [...new Set(rotVals)]
  }
}
console.log('rotation:', JSON.stringify(rotReport))

// 4. Reduced motion: values must still update (no animation, no stuck digits).
const rmPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, reducedMotion: 'reduce' })
await rmPage.goto(url, { waitUntil: 'networkidle' })
await rmPage.evaluate(async () => {
  const store = (window as FlowWindow).__collage.store()
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  canvas.getContext('2d')!.fillRect(0, 0, 400, 300)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  await store.addPhotos([new File([blob!], 'seed.png', { type: 'image/png' })], true)
})
await rmPage.evaluate(() => {
  ;(window as FlowWindow).__stageEl = document.querySelector('.stage-checker')!
})
await rmPage.evaluate(() => {
  ;(window as FlowWindow).__stageEl.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true }))
})
await rmPage.waitForTimeout(400)
const rmVal = await rmPage.evaluate(() => {
  const flow = document.querySelector('[data-view-zoom-chip] number-flow-react') as FlowEl
  return flow ? (flow._data?.valueAsString ?? null) : 'no-chip'
})
console.log('reduced-motion value after one notch:', JSON.stringify(rmVal))
await rmPage.close()

// 5. Export preview chip: open export, double-click the preview to zoom it.
const exportBtn = page.getByRole('button', { name: /export|导出|分享/i }).first()
if (await exportBtn.count()) {
  await exportBtn.click()
  await page.waitForTimeout(700)
  const dbl = await page.evaluate(() => {
    const el = document.querySelector('[data-export-view]')
    const box = el?.parentElement?.getBoundingClientRect()
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
  })
  if (dbl) {
    await page.mouse.dblclick(dbl.x, dbl.y)
    await page.waitForTimeout(500)
    const exportChip = await page.evaluate(() => {
      const chip = document.querySelector('[data-export-zoom-chip]')!
      const cs = getComputedStyle(chip)
      const flow = chip.querySelector('number-flow-react') as FlowEl
      return {
        upgraded: !!flow?.shadowRoot && flow.shadowRoot.childElementCount > 0,
        text: (flow?._data?.valueAsString ?? '').trim(),
        bg: cs.backgroundColor,
        border: cs.borderTopWidth,
        weight: cs.fontWeight,
      }
    })
    console.log('export chip:', JSON.stringify(exportChip))
  }
  else {
    console.log('export chip: preview element not found')
  }
}
else {
  console.log('export chip: no export button matched')
}

// Mobile viewport shot (375x812) per the UI gate.
const mob = await browser.newPage({ viewport: { width: 375, height: 812 }, ignoreHTTPSErrors: true, hasTouch: true })
await mob.goto(url, { waitUntil: 'networkidle' })
await mob.evaluate(async () => {
  const store = (window as FlowWindow).__collage.store()
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  canvas.getContext('2d')!.fillRect(0, 0, 400, 300)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  await store.addPhotos([new File([blob!], 'seed.png', { type: 'image/png' })], true)
})
await mob.waitForTimeout(400)
const mobId = await mob.evaluate(() => (window as FlowWindow).__collage.store().activeId)
await mob.goto(`${url}#/w/${mobId}`, { waitUntil: 'networkidle' })
await mob.waitForTimeout(700)
await mob.evaluate(() => {
  ;(window as FlowWindow).__stageEl = document.querySelector('.stage-checker')!
  ;(window as FlowWindow).__stageEl.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -360, bubbles: true, cancelable: true }))
})
await mob.waitForTimeout(450)
await mob.screenshot({ path: 'shots/nf-mobile-375.png' })
await mob.close()

await browser.close()
console.log('done')
