import type { Dims } from './imageStore'

const HEIC_EXTS = /\.(?:heic|heif|hif)$/i
const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

export function looksHeic(file: File): boolean {
  return HEIC_EXTS.test(file.name) || HEIC_TYPES.has(file.type.toLowerCase())
}

const META_MAX = 8 * 1024 * 1024

class Reader {
  view: DataView
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf)
  }

  u8(at: number) {
    return this.view.getUint8(at)
  }

  u16(at: number) {
    return this.view.getUint16(at)
  }

  u32(at: number) {
    return this.view.getUint32(at)
  }

  type(at: number) {
    return String.fromCharCode(this.u8(at), this.u8(at + 1), this.u8(at + 2), this.u8(at + 3))
  }
}

interface Box {
  start: number
  end: number
}

function readBox(r: Reader, at: number, limit: number): Box | null {
  if (at + 8 > limit)
    return null
  let size = r.u32(at)
  let hdr = 8
  if (size === 1) {
    if (at + 16 > limit)
      return null
    size = r.u32(at + 8) * 2 ** 32 + r.u32(at + 12)
    hdr = 16
  }
  else if (size === 0) {
    size = limit - at
  }
  const end = at + size
  if (end <= at + hdr)
    return null
  return { start: at + hdr, end }
}

function scanForMeta(r: Reader, buf: Uint8Array): Box | null {
  let at = 0
  while (at + 8 <= buf.length) {
    const hdrCut = at + (r.u32(at) === 1 ? 16 : 8)
    if (hdrCut > buf.length)
      break
    const size = r.u32(at)
    if (r.type(at + 4) === 'meta')
      return readBox(r, at, Number.POSITIVE_INFINITY)
    if (size <= 0)
      break
    at += size
  }
  return null
}

async function readMetaBox(file: File): Promise<{ r: Reader, box: Box } | null> {
  let buf = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
  for (;;) {
    const r = new Reader(buf.buffer)
    const meta = scanForMeta(r, buf)
    if (!meta)
      return null
    if (meta.end <= buf.length)
      return { r, box: meta }
    const need = Math.min(meta.end, META_MAX)
    if (need <= buf.length)
      return null
    buf = new Uint8Array(await file.slice(0, need).arrayBuffer())
  }
}

function parsePropBox(r: Reader, pt: string, pb: Box, k: number, ispe: Map<number, Dims>, irot: Map<number, number>): void {
  if (pt === 'ispe' && pb.start + 12 <= pb.end) {
    const w = r.u32(pb.start + 4)
    const h = r.u32(pb.start + 8)
    if (w > 0 && h > 0)
      ispe.set(k, { w, h })
  }
  else if (pt === 'irot' && pb.start < pb.end) {
    irot.set(k, r.u8(pb.start) & 3)
  }
}

function parseIpco(r: Reader, ib: Box, ispe: Map<number, Dims>, irot: Map<number, number>): void {
  let k = 0
  let s = ib.start
  while (s + 8 <= ib.end) {
    const pb = readBox(r, s, ib.end)
    if (!pb)
      break
    k++
    const pt = r.type(s + 4)
    parsePropBox(r, pt, pb, k, ispe, irot)
    s = pb.end
  }
}

function readPropIdxs(r: Reader, a0: number, n: number, end: number, wide: boolean): { idxs: number[], a: number } {
  const idxs: number[] = []
  let a = a0
  for (let j = 0; j < n; j++) {
    if (wide) {
      if (a + 2 > end) {
        a = end
        break
      }
      idxs.push(r.u16(a) & 0x7FFF)
      a += 2
    }
    else {
      if (a >= end)
        break
      idxs.push(r.u8(a) & 0x7F)
      a += 1
    }
  }
  return { idxs, a }
}

function parseIpma(r: Reader, ib: Box, itemProps: Map<number, number[]>): void {
  const ver = r.u8(ib.start)
  const flags = (r.u8(ib.start + 1) << 16) | (r.u8(ib.start + 2) << 8) | r.u8(ib.start + 3)
  const wide = (flags & 1) === 1
  let a = ib.start + 4
  const count = a + 4 <= ib.end ? r.u32(a) : 0
  a += 4
  for (let i = 0; i < count && a < ib.end; i++) {
    let itemId: number
    if (ver < 1) {
      if (a + 2 > ib.end)
        break
      itemId = r.u16(a)
      a += 2
    }
    else {
      if (a + 4 > ib.end)
        break
      itemId = r.u32(a)
      a += 4
    }
    if (a >= ib.end)
      break
    const n = r.u8(a)
    a += 1
    const res = readPropIdxs(r, a, n, ib.end, wide)
    itemProps.set(itemId, res.idxs)
    a = res.a
  }
}

function parseIprp(r: Reader, b: Box, ispe: Map<number, Dims>, irot: Map<number, number>, itemProps: Map<number, number[]>): void {
  let q = b.start
  while (q + 8 <= b.end) {
    const ib = readBox(r, q, b.end)
    if (!ib)
      break
    const it = r.type(q + 4)

    if (it === 'ipco')
      parseIpco(r, ib, ispe, irot)
    else if (it === 'ipma')
      parseIpma(r, ib, itemProps)
    q = ib.end
  }
}

function dimsFromProps(idxs: number[], ispe: Map<number, Dims>, irot: Map<number, number>): { dims: Dims | null, rot: number } {
  let dims: Dims | null = null
  let rot = 0
  for (const k of idxs) {
    if (!dims && ispe.has(k))
      dims = ispe.get(k)!
    if (irot.has(k))
      rot = irot.get(k)!
  }
  return { dims, rot }
}

function resolveMeta(primaryId: number | null, ispe: Map<number, Dims>, irot: Map<number, number>, itemProps: Map<number, number[]>): Dims | null {
  let dims: Dims | null = null
  let rot = 0
  const idxs = primaryId != null ? itemProps.get(primaryId) : null
  if (idxs) {
    const fromProps = dimsFromProps(idxs, ispe, irot)
    dims = fromProps.dims
    rot = fromProps.rot
  }
  else {
    dims = ispe.values().next().value ?? null
    rot = irot.values().next().value ?? 0
  }
  if (!dims)
    return null
  return rot & 1 ? { w: dims.h, h: dims.w } : dims
}

function parseMeta(r: Reader, box: Box): Dims | null {
  const limit = box.end
  let p = box.start + 4

  let primaryId: number | null = null
  const ispe = new Map<number, Dims>()
  const irot = new Map<number, number>()
  const itemProps = new Map<number, number[]>()

  while (p + 8 <= limit) {
    const b = readBox(r, p, limit)
    if (!b)
      break
    const t = r.type(p + 4)

    if (t === 'pitm') {
      primaryId = r.u8(b.start) === 0 ? r.u16(b.start + 4) : r.u32(b.start + 4)
    }
    else if (t === 'iprp') {
      parseIprp(r, b, ispe, irot, itemProps)
    }
    p = b.end
  }

  return resolveMeta(primaryId, ispe, irot, itemProps)
}

export async function probeHeic(file: File): Promise<Dims | null> {
  try {
    const meta = await readMetaBox(file)
    if (!meta)
      return null
    return parseMeta(meta.r, meta.box)
  }
  catch {
    return null
  }
}

let libPromise: Promise<typeof import('heic-to')> | null = null

/** Kick the decoder's download/parse early, before the first pixels are needed. */
export function warmHeicDecoder() {
  libPromise ??= import('heic-to')
}

// heic-to decodes on one internal worker and clones the full-res ImageData
// back; several at once freeze the tab, so WASM decodes run one at a time.
// Interactive work (previews, export) jumps ahead of queued library thumbs;
// a running decode is never preempted and equal priorities stay FIFO.
type Priority = 0 | 1
const waiting: [Priority, () => void][] = []
let decoding = false

function pumpQueue() {
  if (decoding)
    return
  // First interactive entry, else the oldest background one.
  const i = waiting.findIndex(([p]) => p === 0)
  const next = waiting.splice(i < 0 ? 0 : i, 1)[0]
  if (!next)
    return
  decoding = true
  const start = next[1]
  start()
}

function queued<T>(fn: () => Promise<T>, priority: Priority): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push([priority, () => {
      // Promise.resolve().then: a synchronous throw in fn must still clear
      // `decoding`, or every later HEIC decode would queue forever.
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        decoding = false
        pumpQueue()
      })
    }])
    pumpQueue()
  })
}

// Safari/WebKit decode HEIC natively (hardware, no WASM, no full-res ImageData
// round trip). One failed attempt teaches us to skip straight to libheif.
let nativeHeic: boolean | null = null

export async function decodeHeicBitmap(file: File, priority: Priority = 0): Promise<ImageBitmap | null> {
  if (nativeHeic !== false) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      nativeHeic = true
      return bmp
    }
    catch {
      // Confirmed-native browsers can still meet a file the decoder rejects:
      // fall back for this file without unlearning native support.
      if (!nativeHeic)
        nativeHeic = false
    }
  }
  return decodeViaLibheif(file, priority)
}

async function decodeViaLibheif(file: File, priority: Priority): Promise<ImageBitmap | null> {
  try {
    warmHeicDecoder()
    const { heicTo } = await libPromise!
    return await queued(() => heicTo({ blob: file, type: 'bitmap' }), priority)
  }
  catch (e) {
    console.warn('HEIC decode failed:', file.name, e)
    return null
  }
}
