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

async function readMetaBox(file: File): Promise<{ r: Reader, box: Box } | null> {
  let buf = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
  for (;;) {
    const r = new Reader(buf.buffer)
    let at = 0
    let meta: Box | null = null
    while (at + 8 <= buf.length) {
      const hdrCut = at + (r.u32(at) === 1 ? 16 : 8)
      if (hdrCut > buf.length)
        break
      const size = r.u32(at)
      if (r.type(at + 4) === 'meta') {
        meta = readBox(r, at, Number.POSITIVE_INFINITY)
        break
      }
      if (size <= 0)
        break
      at += size
    }
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
      let q = b.start
      while (q + 8 <= b.end) {
        const ib = readBox(r, q, b.end)
        if (!ib)
          break
        const it = r.type(q + 4)

        if (it === 'ipco') {
          let k = 0
          let s = ib.start
          while (s + 8 <= ib.end) {
            const pb = readBox(r, s, ib.end)
            if (!pb)
              break
            k++
            const pt = r.type(s + 4)
            if (pt === 'ispe' && pb.start + 12 <= pb.end) {
              const w = r.u32(pb.start + 4)
              const h = r.u32(pb.start + 8)
              if (w > 0 && h > 0)
                ispe.set(k, { w, h })
            }
            else if (pt === 'irot' && pb.start < pb.end) {
              irot.set(k, r.u8(pb.start) & 3)
            }
            s = pb.end
          }
        }
        else if (it === 'ipma') {
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
            const idxs: number[] = []
            for (let j = 0; j < n; j++) {
              if (wide) {
                if (a + 2 > ib.end) {
                  a = ib.end
                  break
                }
                idxs.push(r.u16(a) & 0x7FFF)
                a += 2
              }
              else {
                if (a >= ib.end)
                  break
                idxs.push(r.u8(a) & 0x7F)
                a += 1
              }
            }
            itemProps.set(itemId, idxs)
          }
        }
        q = ib.end
      }
    }
    p = b.end
  }

  let dims: Dims | null = null
  let rot = 0
  const idxs = primaryId != null ? itemProps.get(primaryId) : null
  if (idxs) {
    for (const k of idxs) {
      if (!dims && ispe.has(k))
        dims = ispe.get(k)!
      if (irot.has(k))
        rot = irot.get(k)!
    }
  }
  else {
    dims = ispe.values().next().value ?? null
    rot = irot.values().next().value ?? 0
  }
  if (!dims)
    return null
  return rot & 1 ? { w: dims.h, h: dims.w } : dims
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

export async function decodeHeicBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    libPromise ??= import('heic-to')
    const { heicTo } = await libPromise
    return await heicTo({ blob: file, type: 'bitmap' })
  }
  catch (e) {
    console.warn('HEIC decode failed:', file.name, e)
    return null
  }
}
