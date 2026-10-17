/**
 * Prove gap=0 Blend is a true photo crossfade: overlap + opposing masks +
 * lighter compositing. No near-black dip; seam is a mix of both sharp colors;
 * fade 0 stays a hard edge. Run: bun scripts/check-blend-crossfade.ts
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const dir = mkdtempSync(join(tmpdir(), 'blend-xfade-'))
const page = join(dir, 'check.html')

writeFileSync(page, `<!doctype html>
<meta charset="utf-8" />
<body><pre id="out">pending</pre>
<script>
function solid(w, h, r, g, b) {
  var c = document.createElement('canvas')
  c.width = w; c.height = h
  var x = c.getContext('2d')
  x.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'
  x.fillRect(0, 0, w, h)
  return c
}
function fadeStamp(ctx, src, rect, side, fade) {
  var cw = Math.ceil(rect.w), ch = Math.ceil(rect.h)
  var sc = document.createElement('canvas')
  sc.width = cw; sc.height = ch
  var s = sc.getContext('2d')
  // src is already sized to the draw rect content
  s.drawImage(src, 0, 0, cw, ch)
  s.globalCompositeOperation = 'destination-in'
  var g = side === 'right'
    ? s.createLinearGradient(cw, 0, cw - fade, 0)
    : s.createLinearGradient(0, 0, fade, 0)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,1)')
  s.fillStyle = g
  s.fillRect(0, 0, cw, ch)
  ctx.drawImage(sc, rect.x, rect.y)
}
function analyze(ctx, W, H, fade) {
  var row = ctx.getImageData(0, H / 2, W, 1).data
  var c0 = W / 2, min = 255, mixed = 0, hardSteps = 0, prev = null
  for (var x = c0 - fade; x <= c0 + fade; x++) {
    var i = x * 4
    var R = row[i], G = row[i + 1], B = row[i + 2]
    var lum = (R + G + B) / 3
    if (lum < min) min = lum
    // Mix of left-red (220,60,60) and right-blue (50,100,220): both R and B elevated.
    if (R > 80 && R < 200 && B > 80 && B < 200 && lum > 60) mixed++
    if (prev) {
      var d = Math.abs(R - prev.R) + Math.abs(G - prev.G) + Math.abs(B - prev.B)
      if (d > 80) hardSteps++
    }
    prev = { R: R, G: G, B: B }
  }
  var ci = c0 * 4
  return {
    min: min,
    center: { R: row[ci], G: row[ci + 1], B: row[ci + 2], lum: (row[ci] + row[ci + 1] + row[ci + 2]) / 3 },
    mixedCount: mixed,
    hardSteps: hardSteps
  }
}
function paint(mode, fade) {
  var W = 800, H = 400
  var red = solid(400, 400, 220, 60, 60)
  var blue = solid(400, 400, 50, 100, 220)
  var c = document.createElement('canvas')
  c.width = W; c.height = H
  var ctx = c.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)
  if (fade <= 0) {
    ctx.drawImage(red, 0, 0)
    ctx.drawImage(blue, 400, 0)
    return analyze(ctx, W, H, 1)
  }
  var g = fade / 2
  var left = { x: 0, y: 0, w: 400 + g, h: 400 }
  var right = { x: 400 - g, y: 0, w: 400 + g, h: 400 }
  // Solid stamps sized to expanded rects (cover with same color)
  var redExp = solid(left.w, left.h, 220, 60, 60)
  var blueExp = solid(right.w, right.h, 50, 100, 220)
  if (mode === 'featherNoOverlap') {
    // Old architecture: abut + fade to transparent over black
    fadeStamp(ctx, red, { x: 0, y: 0, w: 400, h: 400 }, 'right', fade)
    fadeStamp(ctx, blue, { x: 400, y: 0, w: 400, h: 400 }, 'left', fade)
  }
  else if (mode === 'overlapSourceOver') {
    fadeStamp(ctx, redExp, left, 'right', fade)
    fadeStamp(ctx, blueExp, right, 'left', fade)
  }
  else if (mode === 'overlapLighter') {
    ctx.globalCompositeOperation = 'lighter'
    fadeStamp(ctx, redExp, left, 'right', fade)
    fadeStamp(ctx, blueExp, right, 'left', fade)
    ctx.globalCompositeOperation = 'source-over'
  }
  return analyze(ctx, W, H, fade)
}
var fade = 48
var data = {
  featherNoOverlap: paint('featherNoOverlap', fade),
  overlapSourceOver: paint('overlapSourceOver', fade),
  fixed: paint('overlapLighter', fade),
  hard: paint('overlapLighter', 0)
}
document.getElementById('out').textContent = JSON.stringify(data)
</script>
</body>`)

const chrome = process.env.CHROME || 'google-chrome'
const r = spawnSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--virtual-time-budget=5000',
  '--dump-dom',
  `file://${page}`,
], { encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024 })

if (r.status !== 0) {
  console.error('chrome failed', r.stderr?.slice(0, 400))
  rmSync(dir, { recursive: true, force: true })
  process.exit(1)
}

const pre = r.stdout.match(/<pre id="out">([\s\S]*?)<\/pre>/)
if (!pre || pre[1].trim() === 'pending') {
  console.error('script did not run', r.stdout.slice(0, 400))
  rmSync(dir, { recursive: true, force: true })
  process.exit(1)
}

interface Sample {
  min: number
  center: { R: number, G: number, B: number, lum: number }
  mixedCount: number
  hardSteps: number
}
interface Report {
  featherNoOverlap: Sample
  overlapSourceOver: Sample
  fixed: Sample
  hard: Sample
}

const data = JSON.parse(pre[1].trim()) as Report
console.log(JSON.stringify(data, null, 2))

// Old feather-to-black dips near black
if (data.featherNoOverlap.min >= 15)
  throw new Error(`expected featherNoOverlap near-black, got ${data.featherNoOverlap.min}`)
// Fixed: no near-black, soft mix, no hard step
if (data.fixed.min <= 80)
  throw new Error(`fixed min too dark: ${data.fixed.min}`)
if (data.fixed.center.lum <= 80)
  throw new Error(`fixed center too dark: ${data.fixed.center.lum}`)
if (data.fixed.mixedCount < 30)
  throw new Error(`fixed lost crossfade mix: mixedCount=${data.fixed.mixedCount}`)
if (data.fixed.hardSteps !== 0)
  throw new Error(`fixed hardSteps=${data.fixed.hardSteps}`)
// Center must elevate both red and blue channels (true mix of both photos)
if (data.fixed.center.R < 80 || data.fixed.center.B < 80)
  throw new Error(`fixed center not a red|blue mix: ${JSON.stringify(data.fixed.center)}`)
// lighter must beat source-over mid luminance (source-over darkens)
if (data.fixed.center.lum <= data.overlapSourceOver.center.lum)
  throw new Error(`lighter should out-brighten source-over at center`)
if (data.hard.center.lum <= 80)
  throw new Error(`fade0 too dark: ${data.hard.center.lum}`)
if (data.hard.hardSteps < 1)
  throw new Error('fade0 should hard-step')

console.log('check-blend-crossfade: OK')
rmSync(dir, { recursive: true, force: true })
