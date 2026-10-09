import type { Photo } from './imageStore'
import type { Leaf, Node, Rect } from './panes'
import { isTransparentBg } from '../store'
import { decodeFull, releaseFull } from './imageStore'
import { layoutTree, placement, stickerRect } from './panes'

export interface ExportOptions {
  root: Node
  ratio: number
  gap: number
  radius: number
  bg: string
  photos: Map<string, Photo>
  longSide: number
}

export interface ExportSize {
  W: number
  H: number
}

export function computeExportSize(opts: ExportOptions): ExportSize {
  const ar = opts.ratio
  const L = opts.longSide
  return ar >= 1 ? { W: L, H: Math.round(L / ar) } : { W: Math.round(L * ar), H: L }
}

export function outputSizeFor(longSide: number, ratio: number) {
  return computeExportSize({
    longSide,
    ratio,
  } as ExportOptions)
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  c.beginPath()
  if (typeof c.roundRect === 'function') {
    c.roundRect(x, y, w, h, rr)
    return
  }
  c.moveTo(x + rr, y)
  c.arcTo(x + w, y, x + w, y + h, rr)
  c.arcTo(x + w, y + h, x, y + h, rr)
  c.arcTo(x, y + h, x, y, rr)
  c.arcTo(x, y, x + w, y, rr)
  c.closePath()
}

interface Prepared {
  W: number
  H: number
  gap: number
  radius: number
  cells: { leaf: Leaf, rect: Rect, photo: Photo }[]
}

function prepare(opts: ExportOptions, W: number, H: number): Prepared {
  const u = Math.min(W, H) / 1000
  const gap = opts.gap * u
  const l = layoutTree(opts.root, W, H, gap)
  const cells: Prepared['cells'] = []
  for (const { node, rect } of l.leaves) {
    if (!node.photoId)
      continue
    const photo = opts.photos.get(node.photoId)
    if (!photo?.trueW)
      continue
    cells.push({ leaf: node, rect, photo })
  }
  return { W, H, gap, radius: opts.radius * u, cells }
}

export async function renderCollage(opts: ExportOptions): Promise<HTMLCanvasElement> {
  const { W, H } = computeExportSize(opts)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  if (!isTransparentBg(opts.bg)) {
    ctx.fillStyle = opts.bg
    ctx.fillRect(0, 0, W, H)
  }
  ctx.imageSmoothingQuality = 'high'

  const prep = prepare(opts, W, H)
  const stickerSrcs = new Map<string, Awaited<ReturnType<typeof decodeFull>>>()
  for (const { leaf, rect, photo } of prep.cells) {
    const p = placement(rect, leaf, photo.trueW, photo.trueH)
    const src = await decodeFull(photo)
    if (!src)
      continue
    ctx.save()
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, prep.radius)
    ctx.clip()
    ctx.drawImage(src, p.x, p.y, p.w, p.h)
    for (const st of leaf.stickers) {
      const sp = opts.photos.get(st.photoId)
      if (!sp?.trueW || !sp.trueH)
        continue
      let s2 = stickerSrcs.get(st.photoId)
      if (s2 === undefined) {
        s2 = await decodeFull(sp)
        stickerSrcs.set(st.photoId, s2)
      }
      if (!s2)
        continue
      const sr = stickerRect(p, st, sp.trueW, sp.trueH, sp.trueW / sp.trueH)
      ctx.drawImage(s2, sr.x, sr.y, sr.w, sr.h)
    }
    ctx.restore()
    releaseFull(src)
  }
  stickerSrcs.forEach(s2 => releaseFull(s2))
  return canvas
}

export function buildCropReport(opts: ExportOptions): string {
  const { W, H } = computeExportSize(opts)
  const prep = prepare(opts, W, H)
  const lines: string[] = []

  lines.push(`# Export size ${W} × ${H}, ${prep.cells.length} frames total`)
  lines.push('# Save as crop.sh and run it in the photos directory to batch-crop the same framing')
  lines.push('')

  prep.cells.forEach(({ leaf, rect, photo }, i) => {
    const p = placement(rect, leaf, photo.trueW, photo.trueH)
    let sx = Math.round((rect.x - p.x) / p.scale)
    let sy = Math.round((rect.y - p.y) / p.scale)
    let sw = Math.round(rect.w / p.scale)
    let sh = Math.round(rect.h / p.scale)
    sx = Math.max(0, Math.min(photo.trueW - 1, sx))
    sy = Math.max(0, Math.min(photo.trueH - 1, sy))
    sw = Math.max(1, Math.min(photo.trueW - sx, sw))
    sh = Math.max(1, Math.min(photo.trueH - sy, sh))

    lines.push(
      `# Frame ${i + 1} · ${photo.name} · source ${photo.trueW}×${photo.trueH} · crop ${sw}×${sh}`
      + ` (${((sw / photo.trueW) * 100).toFixed(0)}% × ${((sh / photo.trueH) * 100).toFixed(0)}%)`,
    )
    lines.push(
      `magick "${photo.name}" -crop ${sw}x${sh}+${sx}+${sy} +repage "crop_${i + 1}_${photo.name}"`,
    )
    lines.push('')
  })
  return lines.join('\n')
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
