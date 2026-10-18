#!/usr/bin/env node
/**
 * Build `src/data/districts.json` from the AreaCity mainland China boundary
 * set (xiangyuecn/AreaCity-JsSpider-StatsGov, MIT, see THIRD_PARTY_NOTICES.md).
 *
 * The source ships as `ok_geo.csv.7z` (~16.5 MB, ~159 MB unpacked, 5M points
 * across 3,635 province / city / district rows). That raw file is far too big
 * to commit, so this script:
 *
 *   1. downloads it into the OS temp dir (never the repo) unless cached;
 *   2. extracts it with the platform's 7z reader (7z / 7zz / bsdtar / unar);
 *   3. keeps all three administrative depths (deep 0 = province, 1 = city,
 *      2 = district in this data set; the brief's 1/2/3 are the same levels
 *      one-based). District rings keep ~500 m; province / city rings are a
 *      fallback for the few districts without a polygon, so they are
 *      simplified harder (~2 km) to stay inside the size budget;
 *   4. converts every point GCJ-02 -> WGS-84 once (the source is GCJ-02);
 *   5. Douglas-Peucker simplifies each ring;
 *   6. writes a compact array of `[adcode, "province/city/district", rings]`.
 *
 * Rerunnable: the raw download is cached in the temp dir, the generated JSON
 * is deterministic, and `--force` redownloads. Only the JSON is committed.
 *
 * Usage: node scripts/build-districts.mjs [--force]
 */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'src/data/districts.json')
const CACHE = join(tmpdir(), 'koma-districts')
const ARCHIVE = join(CACHE, 'ok_geo.csv.7z')
const CSV = join(CACHE, 'ok_geo.csv')
const SOURCE_URL = 'https://github.com/xiangyuecn/AreaCity-JsSpider-StatsGov/releases/download/2025.251231.260403/ok_geo.csv.7z'
/** ~500 m in latitude degrees; the point metric below scales longitude by cos(lat). */
const TOLERANCE = 0.0045
/** Province / city fallback rings: ~2.2 km, they only disambiguate a missing district polygon. */
const PARENT_TOLERANCE = 0.02
/** 3 decimals ≈ 111 m, still an order of magnitude under the simplification tolerance. */
const DECIMALS = 3

const force = process.argv.includes('--force')

function log(...args) {
  console.log('[districts]', ...args)
}

function fail(message) {
  console.error(`[districts] ${message}`)
  process.exit(1)
}

async function download() {
  if (!force && existsSync(ARCHIVE) && statSync(ARCHIVE).size > 10_000_000) {
    log(`using cached ${ARCHIVE} (${statSync(ARCHIVE).size} bytes)`)
    return
  }
  mkdirSync(CACHE, { recursive: true })
  log(`downloading ${SOURCE_URL}`)
  const res = await fetch(SOURCE_URL, { redirect: 'follow' })
  if (!res.ok)
    fail(`download failed: HTTP ${res.status}`)
  const out = createWriteStream(ARCHIVE)
  await new Promise((resolve, reject) => {
    res.body.pipeTo(new WritableStream({
      write(chunk) {
        return new Promise((done) => {
          if (out.write(chunk))
            done()
          else
            out.once('drain', done)
        })
      },
      close() {
        out.end()
        resolve()
      },
      abort: reject,
    })).catch(reject)
  })
  const size = statSync(ARCHIVE).size
  log(`downloaded ${size} bytes`)
  if (size < 10_000_000)
    fail(`download too small (${size} bytes)`)
}

function extract() {
  if (!force && existsSync(CSV) && statSync(CSV).size > 100_000_000) {
    log(`using cached ${CSV}`)
    return
  }
  rmSync(CSV, { force: true })
  const attempts = [
    ['7z', ['x', '-y', `-o${CACHE}`, ARCHIVE, 'ok_geo.csv']],
    ['7zz', ['x', '-y', `-o${CACHE}`, ARCHIVE, 'ok_geo.csv']],
    ['bsdtar', ['-xf', ARCHIVE, '-C', CACHE, 'ok_geo.csv']],
    ['unar', ['-o', CACHE, '-f', ARCHIVE, 'ok_geo.csv']],
  ]
  for (const [cmd, args] of attempts) {
    const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' })
    if (probe.error)
      continue
    log(`extracting with ${cmd}`)
    const res = spawnSync(cmd, args, { stdio: 'inherit' })
    if (res.status === 0 && existsSync(CSV))
      return
  }
  fail('no 7z reader found (tried 7z, 7zz, bsdtar, unar)')
}

/** One CSV line with quoted fields (the polygon column is quoted and contains no newlines). */
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        }
        else {
          quoted = false
        }
      }
      else {
        cur += c
      }
    }
    else if (c === '"') {
      quoted = true
    }
    else if (c === ',') {
      out.push(cur)
      cur = ''
    }
    else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

/** GCJ-02 (Mars) -> WGS-84, the standard public one-step inverse transform. */
const A = 6378245.0
const EE = 0.006693421622965943
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0
  return ret
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0
  return ret
}
function gcj02ToWgs84(lng, lat) {
  const dLat0 = transformLat(lng - 105.0, lat - 35.0)
  const dLng0 = transformLng(lng - 105.0, lat - 35.0)
  const radLat = lat / 180.0 * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const dLat = (dLat0 * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * Math.PI)
  const dLng = (dLng0 * 180.0) / (A / sqrtMagic * Math.cos(radLat) * Math.PI)
  return [lng - dLng, lat - dLat]
}

/** Squared distance from a point to the segment ab. */
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + t * dx - px
  const qy = ay + t * dy - py
  return qx * qx + qy * qy
}

/** Douglas-Peucker over an open point list; returns the kept indices. */
function simplifyOpen(pts, tol) {
  const n = pts.length
  if (n < 3)
    return [...Array.from({ length: n }).keys()]
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const tol2 = tol * tol
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    if (b <= a + 1)
      continue
    const ax = pts[a][0]
    const ay = pts[a][1]
    const bx = pts[b][0]
    const by = pts[b][1]
    let best = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i][0], pts[i][1], ax, ay, bx, by)
      if (d > best) {
        best = d
        at = i
      }
    }
    if (best > tol2) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  const out = []
  for (let i = 0; i < n; i++) {
    if (keep[i])
      out.push(i)
  }
  return out
}

/**
 * A ring is implicitly closed (the source does not repeat the first point).
 * Split it at the point farthest from index 0, simplify both arcs, and stitch
 * them back so the closing segment is covered too.
 */
function simplifyRing(lngLat, cosLat, tol) {
  const pts = lngLat.map(([lng, lat]) => [lng * cosLat, lat])
  const n = pts.length
  if (n < 4)
    return lngLat
  let k = 1
  let best = -1
  for (let i = 1; i < n; i++) {
    const dx = pts[i][0] - pts[0][0]
    const dy = pts[i][1] - pts[0][1]
    const d = dx * dx + dy * dy
    if (d > best) {
      best = d
      k = i
    }
  }
  const arc1 = simplifyOpen(pts.slice(0, k + 1), tol)
  const arc2Pts = [...pts.slice(k), pts[0]]
  const arc2 = simplifyOpen(arc2Pts, tol).map(i => (k + i) % n)
  const idx = [...arc1, ...arc2.slice(1, -1)]
  const out = []
  for (const i of idx) {
    const [lng, lat] = lngLat[i]
    const p = [Number(lng.toFixed(DECIMALS)), Number(lat.toFixed(DECIMALS))]
    const prev = out[out.length - 1]
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1])
      out.push(p)
  }
  // The stitch can leave a duplicate of the first point at the end.
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1])
    out.pop()
  return out.length >= 3 ? out : null
}

/** One ring's `lng lat,lng lat,...` text; null when fewer than 3 valid points. */
function parseRingText(text) {
  const pts = []
  for (const pair of text.split(',')) {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number)
    if (Number.isFinite(lng) && Number.isFinite(lat))
      pts.push([lng, lat])
  }
  return pts.length >= 3 ? pts : null
}

/**
 * A polygon column: `;` separates parts (islands / enclaves), `~` separates a
 * part's hole rings. Even-odd lookup treats every ring alike, so both become
 * plain rings.
 */
function parseRings(polygon) {
  if (!polygon || polygon === 'EMPTY')
    return null
  const rings = []
  for (const part of polygon.split(';')) {
    for (const piece of part.split('~')) {
      const ring = parseRingText(piece)
      if (ring)
        rings.push(ring)
    }
  }
  return rings.length ? rings : null
}

/** Column name -> index, failing loudly when the release's header changes. */
function readColumns(lines) {
  const header = splitCsvLine(lines[0].replace(/^\uFEFF/, ''))
  const col = Object.fromEntries(header.map((name, i) => [name, i]))
  for (const f of ['id', 'deep', 'name', 'ext_path', 'polygon']) {
    if (col[f] == null)
      fail(`unexpected CSV header: ${header.join(',')}`)
  }
  return col
}

/** Simplified WGS-84 rings for one row, and how many source points they cost. */
function simplifyRow(raw, deep) {
  const tol = deep === 2 ? TOLERANCE : PARENT_TOLERANCE
  const rings = []
  let rawPoints = 0
  for (const ring of raw) {
    rawPoints += ring.length
    // Each ring's own mean latitude keeps the point metric honest along China's span.
    const meanLat = ring.reduce((s, p) => s + p[1], 0) / ring.length
    const simplified = simplifyRing(ring, Math.cos(meanLat * Math.PI / 180), tol)
    if (!simplified)
      continue
    rings.push(simplified.map(([lng, lat]) => gcj02ToWgs84(lng, lat).map(v => Number(v.toFixed(DECIMALS)))))
  }
  return { rings, rawPoints }
}

/** The CSV rows we keep, already simplified and converted. */
function buildRows(lines) {
  const col = readColumns(lines)
  const rows = []
  let rawPoints = 0
  let keptPoints = 0
  let skipped = 0
  for (let li = 1; li < lines.length; li++) {
    if (!lines[li])
      continue
    const fields = splitCsvLine(lines[li])
    const deep = Number(fields[col.deep])
    if (!(deep >= 0 && deep <= 2))
      continue
    const raw = parseRings(fields[col.polygon])
    const path = (fields[col.ext_path] || fields[col.name]).split(' ').filter(Boolean).join('/')
    const simplified = raw ? simplifyRow(raw, deep) : null
    if (!simplified?.rings.length) {
      skipped++
      continue
    }
    rawPoints += simplified.rawPoints
    keptPoints += simplified.rings.reduce((n, ring) => n + ring.length, 0)
    rows.push([Number(fields[col.id]), path, simplified.rings])
  }
  return { rows, rawPoints, keptPoints, skipped }
}

async function main() {
  await download()
  extract()

  const lines = readFileSync(CSV, 'utf8').split('\n')
  const { rows, rawPoints, keptPoints, skipped } = buildRows(lines)
  const json = JSON.stringify(rows)
  writeFileSync(OUT, json)
  const mb = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2)
  log(`wrote ${OUT}`)
  log(`rows ${rows.length} (skipped ${skipped}), points ${rawPoints} -> ${keptPoints}, ${mb} MB`)
}

main().catch((err) => {
  fail(err?.stack ?? String(err))
})
