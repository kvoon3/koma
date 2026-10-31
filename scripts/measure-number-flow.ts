// Browser measurement for the NumberFlow zoom chips. Run with:
// PW_CHROMIUM=<chromium binary> bun scripts/measure-number-flow.ts <port>
import process from 'node:process'
import { chromium } from 'playwright-core'

type FlowWindow = typeof window & {
  __collage: { store: () => { addPhotos: (files: File[], autofill: boolean) => Promise<void> } }
  __stageEl: Element
}

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
await page.evaluate(() => {
  ;(window as FlowWindow).__stageEl = document.querySelector('.stage-checker')!
})

// ctrl+wheel in, one notch every 4 frames, sampling the rendered value.
async function wheelBurst(dir: number, notches: number): Promise<(string | null)[]> {
  return page.evaluate(({ dir, notches }) => {
    const stage = (window as FlowWindow).__stageEl
    const read = (): string | null => {
      const flow = document.querySelector('[data-view-zoom-chip] number-flow-react') as
        | ({ _data?: { valueAsString?: string } } & Element)
        | null
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

const inVals = await wheelBurst(-1, 8)
const distinctIn = [...new Set(inVals.filter((v): v is string => !!v))]
console.log('zoom-in sampled values:', JSON.stringify(distinctIn))

const settled = await wheelBurst(0, 0).then(() => null)
const chipBox = await page.evaluate(() => {
  const chip = document.querySelector('[data-view-zoom-chip]')
  if (!chip)
    return null
  const r = chip.getBoundingClientRect()
  const flow = chip.querySelector('number-flow-react')
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    upgraded: !!flow?.shadowRoot && flow.shadowRoot.childElementCount > 0,
    aria: chip.getAttribute('aria-label'),
  }
})
console.log('settled value:', JSON.stringify(settled), 'chip:', JSON.stringify(chipBox))
await page.screenshot({ path: 'shots/nf-chip-2digit.png', clip: { x: 0, y: 0, width: 300, height: 140 } })

// Push to three digits and re-measure width.
await wheelBurst(-1, 8)
await page.waitForTimeout(350)
const box3 = await page.evaluate(() => {
  const chip = document.querySelector('[data-view-zoom-chip]')
  const flow = chip?.querySelector('number-flow-react') as { _data?: { valueAsString?: string } } | null
  return {
    value: flow?._data?.valueAsString ?? null,
    width: chip ? Math.round(chip.getBoundingClientRect().width) : null,
  }
})
console.log('three-digit value:', JSON.stringify(box3))
await page.screenshot({ path: 'shots/nf-chip-3digit.png', clip: { x: 0, y: 0, width: 300, height: 140 } })

// Wheel back out toward fit; the chip unmounts once the value lands on 100.
const outVals = await wheelBurst(1, 30)
await page.waitForTimeout(400)
const chipGone = await page.evaluate(() => !document.querySelector('[data-view-zoom-chip]'))
const distinctOut = [...new Set(outVals.filter((v): v is string => !!v))]
console.log('zoom-out distinct values:', JSON.stringify(distinctOut), 'chip gone:', chipGone)

// Reduced motion: values must still update (no animation, no stuck digits).
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
  const flow = document.querySelector('[data-view-zoom-chip] number-flow-react') as { _data?: { valueAsString?: string } } | null
  return flow ? (flow._data?.valueAsString ?? null) : 'no-chip'
})
console.log('reduced-motion value after one notch:', JSON.stringify(rmVal))
await rmPage.close()

// Export preview chip: open export, double-click the preview to zoom it.
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
      const chip = document.querySelector('[data-export-zoom-chip]')
      if (!chip)
        return { found: false }
      const flow = chip.querySelector('number-flow-react') as ({ _data?: { valueAsString?: string } } & Element) | null
      return {
        found: true,
        upgraded: !!flow?.shadowRoot && flow.shadowRoot.childElementCount > 0,
        text: (flow?._data?.valueAsString ?? '').trim(),
      }
    })
    console.log('export chip:', JSON.stringify(exportChip))
    const dlg = page.locator('[role="dialog"]').first()
    if (await dlg.count())
      await dlg.screenshot({ path: 'shots/number-flow-export-chip.png' })
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
await mob.waitForTimeout(300)
await mob.evaluate(() => {
  ;(window as FlowWindow).__stageEl = document.querySelector('.stage-checker')!
  ;(window as FlowWindow).__stageEl.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -360, bubbles: true, cancelable: true }))
})
await mob.waitForTimeout(450)
await mob.screenshot({ path: 'shots/nf-mobile-375.png' })
await mob.close()

await browser.close()
console.log('done')
