import type { Photo } from './imageStore'
import type { Leaf, Node, Rect, SeamSides } from './panes'
import { isTransparentBg } from '../store'
import { ensureFonts, fontById, measureLabel, normalLineHeightRatio } from './fonts'
import { t } from './i18n'
import { decodeFull, releaseFull } from './imageStore'
import { labelColors, labelRect, layoutTree, placement, seamFadeWidth, seamSides, stickerRect } from './panes'
import { say } from './toast'

export interface ExportOptions {
  root: Node
  ratio: number
  gap: number
  radius: number
  bg: string
  edgeFade: number
  edgeFadeStrength: number
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
  fade: number
  seam: Map<string, SeamSides>
  cells: { leaf: Leaf, rect: Rect, photo: Photo }[]
  labelCells: { leaf: Leaf, rect: Rect }[]
}

function prepare(opts: ExportOptions, W: number, H: number): Prepared {
  const u = Math.min(W, H) / 1000
  const gap = opts.gap * u
  const l = layoutTree(opts.root, W, H, gap)
  // Backdrop blend: pane edges feather into the shared blurred field drawn
  // behind everything; width 0 turns the whole treatment off.
  const fade = opts.edgeFade * u
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
  return {
    W,
    H,
    u,
    gap,
    radius: opts.radius * u,
    fade,
    seam: fade > 0 ? seamSides(l.leaves, gap) : new Map(),
    cells,
    labelCells,
  }
}

/**
 * Draw one photo with feathered seam edges: painted into a scratch canvas,
 *  alpha-masked per seam edge with successive destination-in gradient fills
 *  (each fill multiplies the alpha, so edges combine), then stamped into the
 *  pane rect. The caller's roundRect clip still rounds the corners.
 */
function drawFadedPhoto(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  p: { x: number, y: number, w: number, h: number },
  rect: Rect,
  seam: SeamSides,
  fade: number,
) {
  const solid = 'rgba(0,0,0,1)'
  const fw = seamFadeWidth(fade, rect)
  if (fw <= 0) {
    ctx.drawImage(src, p.x, p.y, p.w, p.h)
    return
  }
  const cw = Math.max(1, Math.ceil(rect.w))
  const ch = Math.max(1, Math.ceil(rect.h))
  const scratch = document.createElement('canvas')
  scratch.width = cw
  scratch.height = ch
  const sc = scratch.getContext('2d')!
  sc.imageSmoothingQuality = 'high'
  sc.drawImage(src, p.x - rect.x, p.y - rect.y, p.w, p.h)
  sc.globalCompositeOperation = 'destination-in'
  const fadeFill = (g: CanvasGradient) => {
    sc.fillStyle = g
    sc.fillRect(0, 0, cw, ch)
  }
  if (seam.left) {
    const g = sc.createLinearGradient(0, 0, fw, 0)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, solid)
    fadeFill(g)
  }
  if (seam.right) {
    const g = sc.createLinearGradient(cw, 0, cw - fw, 0)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, solid)
    fadeFill(g)
  }
  if (seam.top) {
    const g = sc.createLinearGradient(0, 0, 0, fw)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, solid)
    fadeFill(g)
  }
  if (seam.bottom) {
    const g = sc.createLinearGradient(0, ch, 0, ch - fw)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, solid)
    fadeFill(g)
  }
  ctx.drawImage(scratch, rect.x, rect.y, rect.w, rect.h)
}

/**
 * The shared blurred backdrop field (backdrop mode): every photo painted
 *  unclipped and blurred behind the panes, so their feathered edges melt
 *  into one continuous field. Mirrors the preview's SeamBackdrop layer.
 */
async function drawBackdrop(ctx: CanvasRenderingContext2D, prep: Prepared, opts: ExportOptions) {
  if (typeof ctx.filter !== 'string' || prep.fade <= 0)
    return
  const R = Math.max(prep.u * 40, prep.fade)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, opts.edgeFadeStrength / 100))
  for (const { leaf, rect, photo } of prep.cells) {
    const src = await decodeFull(photo)
    if (!src)
      continue
    const p = placement(rect, leaf, photo.trueW, photo.trueH)
    ctx.save()
    ctx.filter = `blur(${R}px)`
    ctx.drawImage(src, p.x, p.y, p.w, p.h)
    ctx.restore()
    releaseFull(src)
  }
  ctx.restore()
}

/**
 * Clip each photo into its pane, draw it placed (feathered at seams), then
 *  its stickers; each photo's full bitmap is decoded once and released right
 *  after its cell.
 */
async function drawPhotoCells(ctx: CanvasRenderingContext2D, prep: Prepared, opts: ExportOptions) {
  const stickerSrcs = new Map<string, Awaited<ReturnType<typeof decodeFull>>>()
  for (const { leaf, rect, photo } of prep.cells) {
    const p = placement(rect, leaf, photo.trueW, photo.trueH)
    const src = await decodeFull(photo)
    if (!src)
      continue
    ctx.save()
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, prep.radius)
    ctx.clip()
    const seam = prep.seam.get(leaf.id)
    if (seam && (seam.left || seam.right || seam.top || seam.bottom))
      drawFadedPhoto(ctx, src, p, rect, seam, prep.fade)
    else
      ctx.drawImage(src, p.x, p.y, p.w, p.h)
    await drawStickers(ctx, p, leaf, opts.photos, stickerSrcs)
    ctx.restore()
    releaseFull(src)
  }
  stickerSrcs.forEach(s2 => releaseFull(s2))
}

/** Draw one leaf's stickers over its photo, sharing a decoded source per photo id. */
async function drawStickers(
  ctx: CanvasRenderingContext2D,
  p: { x: number, y: number, w: number, h: number },
  leaf: Leaf,
  photos: Map<string, Photo>,
  stickerSrcs: Map<string, Awaited<ReturnType<typeof decodeFull>>>,
) {
  for (const st of leaf.stickers) {
    const sp = photos.get(st.photoId)
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
}

/** Load the fonts any label needs; warn when some fell back to system. */
async function ensureLabelFonts(prep: Prepared) {
  if (!prep.labelCells.length)
    return
  const ids = [...new Set(prep.labelCells.map(({ leaf }) => leaf.label!.font))]
  const failed = await ensureFonts(ids)
  if (failed.length) {
    const names = failed.map(id => fontById(id).label).join(', ')
    say(t('Fonts unavailable, used system fallback: {names}', { names }))
  }
}

/** Labels draw on top of photos, clipped to their pane (but not to the photo). */
function drawLabelCells(ctx: CanvasRenderingContext2D, prep: Prepared) {
  for (const { leaf, rect } of prep.labelCells)
    drawLabelCell(ctx, prep, leaf, rect)
}

function drawLabelCell(ctx: CanvasRenderingContext2D, prep: Prepared, leaf: Leaf, rect: Rect) {
  const lab = leaf.label
  if (!lab || !lab.text.trim())
    return
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
  // The blurred field goes under the panes; their feathered edges melt into it.
  await drawBackdrop(ctx, prep, opts)
  await drawPhotoCells(ctx, prep, opts)
  await ensureLabelFonts(prep)
  drawLabelCells(ctx, prep)
  return canvas
}

// --- Live video export ------------------------------------------------------

const VIDEO_MIMES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']

/** Any pane holding a paired Live Photo video? Drives the export flow's extra recording. */
export function hasLiveCells(opts: ExportOptions): boolean {
  const { W, H } = computeExportSize(opts)
  return prepare(opts, W, H).cells.some(c => !!c.photo.videoFile)
}

function loadVideoEl(file: File): Promise<HTMLVideoElement | null> {
  return new Promise((res) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    const url = URL.createObjectURL(file)
    v.onloadeddata = () => res(v)
    v.onerror = () => {
      URL.revokeObjectURL(url)
      res(null)
    }
    v.src = url
  })
}

/**
 * Record the collage as a video where every Live Photo pane plays its paired
 *  MOV over the rendered still: the still carries layout, backdrop, labels
 *  and non-live panes; each live cell's video frame is clipped into its pane
 *  (seam-feathered like the still) with its stickers/label redrawn on top.
 *  Realtime MediaRecorder capture for the longest video's duration.
 *  ponytail: no audio; mux the MOVs' captureStream() audio in if it matters.
 */
export async function renderCollageVideo(
  opts: ExportOptions,
  still: HTMLCanvasElement,
): Promise<{ blob: Blob, ext: 'mp4' | 'webm' } | null> {
  const mime = typeof MediaRecorder !== 'undefined'
    ? VIDEO_MIMES.find(m => MediaRecorder.isTypeSupported(m)) ?? null
    : null
  if (!mime)
    return null
  const { W, H } = computeExportSize(opts)
  const prep = prepare(opts, W, H)
  const vids = await loadLiveVideos(prep.cells.filter(c => !!c.photo.videoFile))
  if (!vids.length)
    return null

  // Sticker sources for live cells decode up front, so the frame loop's
  //  fire-and-forget drawStickers never does real async work mid-frame.
  const stickerSrcs = await prewarmStickerSrcs(vids, opts)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'

  const drawFrame = () => {
    ctx.drawImage(still, 0, 0)
    for (const { cell, v } of vids)
      drawLiveCell(ctx, prep, cell, v, opts, stickerSrcs)
  }

  const stream = canvas.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  const chunks: BlobPart[] = []
  rec.ondataavailable = e => e.data.size && chunks.push(e.data)

  const duration = Math.max(3, ...vids.map(({ v }) => (Number.isFinite(v.duration) ? v.duration : 0)))
  await new Promise<void>((resolve) => {
    rec.onstop = () => resolve()
    const t0 = performance.now()
    const step = () => {
      drawFrame()
      if ((performance.now() - t0) / 1000 < duration)
        requestAnimationFrame(step)
      else
        rec.stop()
    }
    for (const { v } of vids) {
      v.currentTime = 0
      v.play().catch(() => {})
    }
    rec.start()
    step()
  })

  for (const { v, url } of vids) {
    v.pause()
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  }
  stickerSrcs.forEach(s2 => releaseFull(s2))
  stream.getTracks().forEach(tr => tr.stop())
  canvas.width = canvas.height = 0

  return { blob: new Blob(chunks, { type: mime }), ext: mime.includes('mp4') ? 'mp4' : 'webm' }
}

interface LiveVid {
  cell: Prepared['cells'][number]
  v: HTMLVideoElement
  url: string
}

/** Decode every live cell's paired video; cells whose MOV fails to load drop out (their still stays). */
async function loadLiveVideos(lives: Prepared['cells']): Promise<LiveVid[]> {
  const vids: LiveVid[] = []
  for (const cell of lives) {
    const v = await loadVideoEl(cell.photo.videoFile!)
    if (v)
      vids.push({ cell, v, url: v.src })
  }
  return vids
}

async function prewarmStickerSrcs(
  vids: LiveVid[],
  opts: ExportOptions,
): Promise<Map<string, Awaited<ReturnType<typeof decodeFull>>>> {
  const stickerSrcs = new Map<string, Awaited<ReturnType<typeof decodeFull>>>()
  for (const { cell } of vids) {
    for (const st of cell.leaf.stickers) {
      const sp = opts.photos.get(st.photoId)
      if (sp?.trueW && !stickerSrcs.has(st.photoId)) {
        const s2 = await decodeFull(sp)
        if (s2)
          stickerSrcs.set(st.photoId, s2)
      }
    }
  }
  return stickerSrcs
}

/** One live cell's video frame clipped into its pane, with stickers and label back on top. */
function drawLiveCell(
  ctx: CanvasRenderingContext2D,
  prep: Prepared,
  cell: Prepared['cells'][number],
  v: HTMLVideoElement,
  opts: ExportOptions,
  stickerSrcs: Map<string, Awaited<ReturnType<typeof decodeFull>>>,
) {
  const { leaf, rect } = cell
  const p = placement(rect, leaf, v.videoWidth, v.videoHeight)
  ctx.save()
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, prep.radius)
  ctx.clip()
  const seam = prep.seam.get(leaf.id)
  if (seam && (seam.left || seam.right || seam.top || seam.bottom))
    drawFadedPhoto(ctx, v, p, rect, seam, prep.fade)
  else
    ctx.drawImage(v, p.x, p.y, p.w, p.h)
  ctx.restore()
  void drawStickers(ctx, p, leaf, opts.photos, stickerSrcs)
  drawLabelCell(ctx, prep, leaf, rect)
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
