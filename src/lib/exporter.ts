import type { Photo } from './imageStore'
import type { Leaf, Node, Rect } from './panes'
import { isTransparentBg } from '../store'
import { ensureFonts, fontById, measureLabel, normalLineHeightRatio } from './fonts'
import { decodeFull, releaseFull } from './imageStore'
import { labelColors, labelRect, layoutTree, placement, stickerRect } from './panes'
import { say } from './toast'

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
  u: number
  gap: number
  radius: number
  cells: { leaf: Leaf, rect: Rect, photo: Photo }[]
  labelCells: { leaf: Leaf, rect: Rect }[]
}

function prepare(opts: ExportOptions, W: number, H: number): Prepared {
  const u = Math.min(W, H) / 1000
  const gap = opts.gap * u
  const l = layoutTree(opts.root, W, H, gap)
  const cells: Prepared['cells'] = []
  const labelCells: Prepared['labelCells'] = []
  for (const { node, rect } of l.leaves) {
    if (node.label)
      labelCells.push({ leaf: node, rect })
    if (!node.photoId)
      continue
    const photo = opts.photos.get(node.photoId)
    if (!photo?.trueW)
      continue
    cells.push({ leaf: node, rect, photo })
  }
  return { W, H, u, gap, radius: opts.radius * u, cells, labelCells }
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

  // Labels draw on top of photos, clipped to their pane (but not to the photo).
  if (prep.labelCells.length) {
    const ids = [...new Set(prep.labelCells.map(({ leaf }) => leaf.label!.font))]
    const failed = await ensureFonts(ids)
    if (failed.length) {
      const names = failed.map(id => fontById(id).label).join(', ')
      say(`Fonts unavailable, used system fallback: ${names}`)
    }
  }
  for (const { leaf, rect } of prep.labelCells) {
    const lab = leaf.label!
    if (!lab.text.trim())
      continue
    const meta = fontById(lab.font)
    const fontPx = lab.size * prep.u
    const m = measureLabel(meta, fontPx, lab.text)
    // Reproduce the DOM preview's `line-height: normal` line box exactly:
    // box height = measured line box, baseline offset follows the half-leading model.
    const lineH = normalLineHeightRatio(meta, lab.text) * fontPx || (m.fontAscent + m.fontDescent)
    const halfLead = Math.max(0, (lineH - (m.fontAscent + m.fontDescent)) / 2)
    const r = labelRect(rect, lab, m.w, lineH, fontPx)
    const colors = labelColors(lab.theme)
    ctx.save()
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, prep.radius)
    ctx.clip()
    ctx.fillStyle = colors.bg
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = colors.fg
    ctx.font = `400 ${fontPx}px ${meta.cssStack}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(lab.text, r.x + r.w / 2, r.y + fontPx * 0.22 + halfLead + m.fontAscent)
    ctx.restore()
  }
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
