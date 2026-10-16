/**
 * Prove blend + black gap fill: no near-black dip at the join, and a soft
 * crossfade band still exists (intermediate colors, not a hard step).
 * Mirrors export drawBackdrop (opaque leaf composite, then one blur) over
 * BG=#000. Run: bun scripts/check-blend-backdrop.ts
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
function analyze(ctx, W, H, fade) {
  var row = ctx.getImageData(0, H / 2, W, 1).data
  var c0 = W / 2, min = 255, mixed = 0, hardSteps = 0
  var prev = null
  for (var x = c0 - fade; x <= c0 + fade; x++) {
    var i = x * 4
    var R = row[i], G = row[i + 1], B = row[i + 2]
    var lum = (R + G + B) / 3
    if (lum < min) min = lum
    // purple-ish mix of left-red (220,60,60) and right-blue (50,100,220)
    if (R > 70 && R < 190 && B > 70 && B < 190 && lum > 50) mixed++
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
  var left = { x: 0, y: 0, w: 400, h: 400 }
  var right = { x: 400, y: 0, w: 400, h: 400 }
  var red = solid(400, 400, 220, 60, 60)
  var blue = solid(400, 400, 50, 100, 220)
  var c = document.createElement('canvas')
  c.width = W; c.height = H
  var ctx = c.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)
  var Rblur = Math.max(16, fade)
  if (fade > 0) {
    if (mode === 'compositeBlur') {
      var off = document.createElement('canvas')
      off.width = W; off.height = H
      var o = off.getContext('2d')
      ;[[red, left], [blue, right]].forEach(function (pair) {
        var src = pair[0], rect = pair[1]
        o.save()
        o.beginPath()
        o.rect(rect.x, rect.y, rect.w, rect.h)
        o.clip()
        o.drawImage(src, rect.x, rect.y, rect.w, rect.h)
        o.restore()
      })
      ctx.save()
      if (typeof ctx.filter === 'string') ctx.filter = 'blur(' + Rblur + 'px)'
      ctx.drawImage(off, 0, 0)
      ctx.restore()
    }
    else if (mode === 'opaqueUnderlay') {
      ;[[red, left], [blue, right]].forEach(function (pair) {
        var src = pair[0], rect = pair[1]
        ctx.save()
        ctx.beginPath()
        ctx.rect(rect.x, rect.y, rect.w, rect.h)
        ctx.clip()
        ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h)
        ctx.restore()
      })
      ;[[red, left], [blue, right]].forEach(function (pair) {
        var src = pair[0], rect = pair[1]
        ctx.save()
        if (typeof ctx.filter === 'string') ctx.filter = 'blur(' + Rblur + 'px)'
        ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h)
        ctx.restore()
      })
    }
    fadePhoto(ctx, red, left, 'right', fade)
    fadePhoto(ctx, blue, right, 'left', fade)
  }
  else {
    ctx.drawImage(red, left.x, left.y)
    ctx.drawImage(blue, right.x, right.y)
  }
  return analyze(ctx, W, H, fade || 1)
}
var fade = 48
var data = {
  noBackdrop: paint('none', fade),
  opaqueUnderlay: paint('opaqueUnderlay', fade),
  fixed: paint('compositeBlur', fade),
  hard: paint('compositeBlur', 0)
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
  noBackdrop: Sample
  opaqueUnderlay: Sample
  fixed: Sample
  hard: Sample
}

const data = JSON.parse(pre[1].trim()) as Report
console.log(JSON.stringify(data, null, 2))

if (data.noBackdrop.min >= 15)
  throw new Error(`expected noBackdrop near-black, got min=${data.noBackdrop.min}`)
if (data.fixed.min <= 80)
  throw new Error(`fixed min too dark: ${data.fixed.min}`)
if (data.fixed.center.lum <= 80)
  throw new Error(`fixed center too dark: ${data.fixed.center.lum}`)
if (data.hard.center.lum <= 80)
  throw new Error(`fade0 center too dark: ${data.hard.center.lum}`)
// Soft crossfade must still exist: many intermediate pixels, no hard RGB jump.
if (data.fixed.mixedCount < 30)
  throw new Error(`fixed lost blend transition: mixedCount=${data.fixed.mixedCount} (want >= 30)`)
if (data.fixed.hardSteps !== 0)
  throw new Error(`fixed has hard seam step: hardSteps=${data.fixed.hardSteps}`)
// Regression guard: composite-then-blur must keep more mix than the rejected opaque-underlay approach.
if (data.fixed.mixedCount <= data.opaqueUnderlay.mixedCount)
  throw new Error(`fixed mix (${data.fixed.mixedCount}) should beat opaqueUnderlay (${data.opaqueUnderlay.mixedCount})`)

console.log('check-blend-backdrop: OK')
rmSync(dir, { recursive: true, force: true })
