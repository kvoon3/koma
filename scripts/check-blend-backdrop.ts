import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/**
 * Prove blend + black gap fill no longer punches a near-black dip at the join.
 * Mirrors exporter drawBackdrop (opaque leaf-clipped underlay, then blur) and
 * drawFadedPhoto over BG=#000. Run: bun scripts/check-blend-backdrop.ts
 */
import process from 'node:process'

const dir = mkdtempSync(join(tmpdir(), 'blend-check-'))
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
function fadePhoto(ctx, src, rect, side, fade) {
  var cw = Math.ceil(rect.w), ch = Math.ceil(rect.h)
  var sc = document.createElement('canvas')
  sc.width = cw; sc.height = ch
  var s = sc.getContext('2d')
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
function paint(opts) {
  var W = 800, H = 400, fade = opts.fade
  var left = { x: 0, y: 0, w: 400, h: 400 }
  var right = { x: 400, y: 0, w: 400, h: 400 }
  var red = solid(400, 400, 220, 60, 60)
  var blue = solid(400, 400, 50, 100, 220)
  var c = document.createElement('canvas')
  c.width = W; c.height = H
  var ctx = c.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)
  var R = Math.max(16, fade)
  if (fade > 0) {
    ctx.save()
    ctx.globalAlpha = 1
    if (opts.underlay) {
      ;[[red, left], [blue, right]].forEach(function (pair) {
        var src = pair[0], rect = pair[1]
        ctx.save()
        ctx.beginPath()
        ctx.rect(rect.x, rect.y, rect.w, rect.h)
        ctx.clip()
        ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h)
        ctx.restore()
      })
    }
    if (opts.blur && typeof ctx.filter === 'string') {
      ;[[red, left], [blue, right]].forEach(function (pair) {
        var src = pair[0], rect = pair[1]
        ctx.save()
        ctx.filter = 'blur(' + R + 'px)'
        ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h)
        ctx.restore()
      })
    }
    ctx.restore()
    fadePhoto(ctx, red, left, 'right', fade)
    fadePhoto(ctx, blue, right, 'left', fade)
  }
  else {
    ctx.drawImage(red, left.x, left.y)
    ctx.drawImage(blue, right.x, right.y)
  }
  var row = ctx.getImageData(0, H / 2, W, 1).data
  var lum = []
  for (var x = 0; x < W; x++) {
    var i = x * 4
    lum.push((row[i] + row[i + 1] + row[i + 2]) / 3)
  }
  var c0 = W / 2, min = 255
  for (var x = c0 - 60; x <= c0 + 60; x++) {
    if (lum[x] < min)
      min = lum[x]
  }
  return { min: min, center: lum[c0], left: lum[c0 - 100], right: lum[c0 + 100] }
}
var fade = 48
var data = {
  noBackdrop: paint({ fade: fade, underlay: false, blur: false }),
  blurOnly: paint({ fade: fade, underlay: false, blur: true }),
  fixed: paint({ fade: fade, underlay: true, blur: true }),
  underlayOnly: paint({ fade: fade, underlay: true, blur: false }),
  hard: paint({ fade: 0, underlay: true, blur: true })
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

interface Sample { min: number, center: number, left: number, right: number }
interface Report {
  noBackdrop: Sample
  blurOnly: Sample
  fixed: Sample
  underlayOnly: Sample
  hard: Sample
}

const data = JSON.parse(pre[1].trim()) as Report
console.log(JSON.stringify(data, null, 2))

if (data.noBackdrop.min >= 15)
  throw new Error(`expected noBackdrop near-black, got min=${data.noBackdrop.min}`)
if (data.fixed.min <= 80)
  throw new Error(`fixed min too dark: ${data.fixed.min}`)
if (data.fixed.center <= 80)
  throw new Error(`fixed center too dark: ${data.fixed.center}`)
if (data.underlayOnly.min <= 80)
  throw new Error(`underlayOnly min too dark: ${data.underlayOnly.min}`)
if (data.hard.center <= 80)
  throw new Error(`fade0 center too dark: ${data.hard.center}`)
if (data.fixed.min - data.noBackdrop.min <= 60)
  throw new Error(`fixed did not clear the black dip enough`)

console.log('check-blend-backdrop: OK')
rmSync(dir, { recursive: true, force: true })
