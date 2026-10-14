import type { FullSource, FullSourceBatch, Photo } from './imageStore'
import type { Leaf, Node, Rect, SeamSides } from './panes'
import { isTransparentBg } from '../store'
import { mapSeq } from './async'
import { ensureFonts, fontById, measureLabel, normalLineHeightRatio } from './fonts'
import { t } from './i18n'
import { acquireFullBatch } from './imageStore'
import { labelColors, labelRect, layoutTree, leafList, placement, rotationOf, seamFadeWidth, seamSides, stickerRect } from './panes'
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

/** Every photo a collage paint will draw, cells first then their stickers, deduped. */
function paintPhotos(prep: Prepared, photos: Map<string, Photo>): Photo[] {
  const wanted: Photo[] = []
  for (const { leaf, photo } of prep.cells) {
    wanted.push(photo)
    for (const st of leaf.stickers) {
      const sp = photos.get(st.photoId)
      if (sp?.trueW && sp.trueH)
        wanted.push(sp)
    }
  }
  return [...new Set(wanted)]
}

/**
 * Resolve the batch's sources one decode at a time, the same pace the old
 * per-cell awaits kept, before the first draw. The chain keeps the order
 * explicit without a loop whose awaits read as an accident.
 */
async function resolveSources(wanted: Photo[], sources: FullSourceBatch): Promise<Map<Photo, FullSource | null>> {
  const entries = await wanted.reduce<Promise<[Photo, FullSource | null][]>>(
    (chain, photo) => chain.then(async (acc) => {
      acc.push([photo, await sources.get(photo)])
      return acc
    }),
    Promise.resolve([]),
  )
  return new Map(entries)
}

/**
 * The shared blurred backdrop field (backdrop mode): every photo painted
 *  unclipped and blurred behind the panes, so their feathered edges melt
 *  into one continuous field. Mirrors the preview's SeamBackdrop layer.
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, prep: Prepared, opts: ExportOptions, src: Map<Photo, FullSource | null>) {
  if (typeof ctx.filter !== 'string' || prep.fade <= 0)
    return
  const R = Math.max(prep.u * 40, prep.fade)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, opts.edgeFadeStrength / 100))
  for (const { leaf, rect, photo } of prep.cells) {
    // Only panes that face another photo-bearing pane contribute to the
    // blurred backdrop; otherwise the backdrop would bleed into (and fill)
    // empty neighboring panes.
    const seam = prep.seam.get(leaf.id)
    if (!seam || !(seam.left || seam.right || seam.top || seam.bottom))
      continue
    const full = src.get(photo)
    if (!full)
      continue
    const p = placement(rect, leaf, photo.trueW, photo.trueH)
    ctx.save()
    ctx.filter = `blur(${R}px)`
    ctx.drawImage(full.src, p.x, p.y, p.w, p.h)
    ctx.restore()
  }
  ctx.restore()
}

/**
 * Clip each photo into its pane, draw it placed (feathered at seams), then
 *  its stickers; `src` hands out each photo's resolved full bitmap.
 */
function drawPhotoCells(ctx: CanvasRenderingContext2D, prep: Prepared, opts: ExportOptions, src: Map<Photo, FullSource | null>) {
  for (const { leaf, rect, photo } of prep.cells) {
    const full = src.get(photo)
    if (!full)
      continue
    const p = placement(rect, leaf, photo.trueW, photo.trueH)
    ctx.save()
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, prep.radius)
    ctx.clip()
    const seam = prep.seam.get(leaf.id)
    if (seam && (seam.left || seam.right || seam.top || seam.bottom))
      drawFadedPhoto(ctx, full.src, p, rect, seam, prep.fade)
    else
      ctx.drawImage(full.src, p.x, p.y, p.w, p.h)
    drawStickers(ctx, p, leaf, opts.photos, src)
    ctx.restore()
  }
}

/** Draw one leaf's stickers over its photo, through the run's resolved sources. */
function drawStickers(
  ctx: CanvasRenderingContext2D,
  p: { x: number, y: number, w: number, h: number },
  leaf: Leaf,
  photos: Map<string, Photo>,
  src: Map<Photo, FullSource | null>,
) {
  for (const st of leaf.stickers) {
    const sp = photos.get(st.photoId)
    if (!sp?.trueW || !sp.trueH)
      continue
    const full = src.get(sp)
    if (!full)
      continue
    const sr = stickerRect(p, st, sp.trueW, sp.trueH, sp.trueW / sp.trueH)
    // Rotation is about the box center, exactly like the preview's CSS transform.
    ctx.save()
    ctx.translate(sr.x + sr.w / 2, sr.y + sr.h / 2)
    ctx.rotate(rotationOf(st))
    ctx.drawImage(full.src, -sr.w / 2, -sr.h / 2, sr.w, sr.h)
    ctx.restore()
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
  // Draw the box around its center, turned like the preview's label box, so
  // the rotated label sits in the same spot the editor shows.
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
  ctx.rotate(rotationOf(lab))
  ctx.fillStyle = colors.bg
  ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h)
  ctx.fillStyle = colors.fg
  ctx.font = `400 ${fontPx}px ${meta.cssStack}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(lab.text, 0, -r.h / 2 + fontPx * 0.22 + halfLead + m.fontAscent)
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
  // One refcounted full decode per photo for the whole run: a photo can fill
  // several panes and back stickers, and every draw must finish before the
  // batch releases (release closes the last-referenced bitmap).
  const sources = acquireFullBatch()
  try {
    // Resolve every source before the first draw, then paint synchronously:
    // the draws share one 2D context, so their order is the output.
    const src = await resolveSources(paintPhotos(prep, opts.photos), sources)
    // The blurred field goes under the panes; their feathered edges melt into it.
    drawBackdrop(ctx, prep, opts, src)
    drawPhotoCells(ctx, prep, opts, src)
    await ensureLabelFonts(prep)
    drawLabelCells(ctx, prep)
  }
  finally {
    sources.release()
  }
  return canvas
}

// --- Live video export ------------------------------------------------------

const VIDEO_MIMES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']

/** Any pane holding a paired Live Photo video? Drives the export flow's extra recording. */
export function hasLiveCells(opts: ExportOptions): boolean {
  const { W, H } = computeExportSize(opts)
  return prepare(opts, W, H).cells.some(c => !!c.photo.videoFile)
}

/** Decode one already-owned object URL; the caller owns the URL's lifetime. */
function loadVideoEl(url: string): Promise<HTMLVideoElement | null> {
  return new Promise((res) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.onloadeddata = () => res(v)
    v.onerror = () => res(null)
    v.src = url
  })
}

interface LiveVid {
  cell: Prepared['cells'][number]
  v: HTMLVideoElement
  url: string
}

/**
 * One ownership scope for the paired MOV decoders: the object URLs are minted
 * here, and every one of them, loaded or not, is released here when the
 * recording ends or the scope unwinds.
 */
async function withLiveVideos<T>(
  lives: Prepared['cells'],
  run: (vids: LiveVid[]) => Promise<T>,
): Promise<T | null> {
  const urls: string[] = []
  const vids: LiveVid[] = []
  try {
    for (const cell of lives)
      urls.push(URL.createObjectURL(cell.photo.videoFile!))
    if (!urls.length)
      return null
    // Loads run together: every decoder is alive for the whole recording
    // either way, so staggering the starts only delays the first frame.
    const loaded = await Promise.all(urls.map(url => loadVideoEl(url)))
    for (const [i, v] of loaded.entries()) {
      if (v)
        vids.push({ cell: lives[i], v, url: urls[i] })
    }
    if (!vids.length)
      return null
    return await run(vids)
  }
  finally {
    for (const { v } of vids) {
      v.pause()
      v.removeAttribute('src')
      v.load()
    }
    for (const url of urls)
      URL.revokeObjectURL(url)
  }
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

  return await withLiveVideos(prep.cells.filter(c => !!c.photo.videoFile), async (vids) => {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'

    // Sticker sources decode through the same refcounted batch as an export
    // and are resolved up front, so the frame loop below is fully
    // synchronous: no decode or late acquire can land mid-frame.
    const sources = acquireFullBatch()
    const stream = canvas.captureStream(30)
    try {
      const src = await resolveSources(stickerPhotos(vids, opts), sources)

      const drawFrame = () => {
        ctx.drawImage(still, 0, 0)
        for (const { cell, v } of vids)
          drawLiveCell(ctx, prep, cell, v, opts, src)
      }

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

      return { blob: new Blob(chunks, { type: mime }), ext: mime.includes('mp4') ? 'mp4' : 'webm' }
    }
    finally {
      sources.release()
      stream.getTracks().forEach(tr => tr.stop())
      canvas.width = canvas.height = 0
    }
  })
}

/** The sticker sources the live frame loop will draw, deduped. */
function stickerPhotos(vids: LiveVid[], opts: ExportOptions): Photo[] {
  const wanted: Photo[] = []
  for (const { cell } of vids) {
    for (const st of cell.leaf.stickers) {
      const sp = opts.photos.get(st.photoId)
      if (sp?.trueW)
        wanted.push(sp)
    }
  }
  return [...new Set(wanted)]
}

/** One live cell's video frame clipped into its pane, with stickers and label back on top. */
function drawLiveCell(
  ctx: CanvasRenderingContext2D,
  prep: Prepared,
  cell: Prepared['cells'][number],
  v: HTMLVideoElement,
  opts: ExportOptions,
  src: Map<Photo, FullSource | null>,
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
  drawStickers(ctx, p, leaf, opts.photos, src)
  drawLabelCell(ctx, prep, leaf, rect)
}

// --- 3×3 grid snapshot ------------------------------------------------------

/**
 * The overview's largest cell, in px (the WorkspaceGrid cell clamp). The board
 * snapshot scales its cell gap from the same reference, so the image keeps the
 * on-screen proportions at any resolution.
 */
export const GRID_CELL_MAX = 220

export interface GridSnapshotOptions {
  /** The nine workspaces in grid order; anything past 9 is ignored. */
  workspaces: { root: Node, canvasRatio: number | null }[]
  /** Long edge of the finished board, in px: each cell gets about a third. */
  longSide: number
  /** Space between the nine overview cells, in px (the store's grid gap). */
  gridGap: number
  radius: number
  bg: string
  edgeFade: number
  edgeFadeStrength: number
  photos: Map<string, Photo>
}

/**
 * The 3×3 overview as one image: the same nine square cells the grid draws,
 * cover-fit and laid out with the grid gap on the collage background. A cell
 * renders like its preview, panes flushed and the collage's short edge mapped
 * onto the cell, then the cover overflow is cropped away; empty cells stay
 * blank (the background, or nothing at all while the gap fill is transparent).
 */
export async function renderGridSnapshot(opts: GridSnapshotOptions): Promise<HTMLCanvasElement> {
  const cell = Math.max(240, Math.round(opts.longSide / 3))
  const gap = Math.round(opts.gridGap * cell / GRID_CELL_MAX)
  const size = cell * 3 + gap * 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  if (!isTransparentBg(opts.bg)) {
    ctx.fillStyle = opts.bg
    ctx.fillRect(0, 0, size, size)
  }
  // Up to nine full-resolution collage renders, each drawn into the reused
  // grid canvas in cell order; the first failure aborts the snapshot.
  await mapSeq(opts.workspaces.slice(0, 9), async (ws, i) => {
    if (!leafList(ws.root).some(l => l.photoId))
      return
    const ratio = ws.canvasRatio ?? 1.5
    // Large enough to cover the square cell, like CellPreview's cover-fit scale.
    const c = await renderCollage({
      root: ws.root,
      ratio,
      // The overview lays its previews out flush (no pane gap), and this is a
      // snapshot of that overview.
      gap: 0,
      radius: opts.radius,
      bg: opts.bg,
      edgeFade: opts.edgeFade,
      edgeFadeStrength: opts.edgeFadeStrength,
      photos: opts.photos,
      longSide: Math.round(cell * Math.max(ratio, 1 / ratio)),
    })
    ctx.drawImage(
      c,
      (c.width - cell) / 2,
      (c.height - cell) / 2,
      cell,
      cell,
      (i % 3) * (cell + gap),
      Math.floor(i / 3) * (cell + gap),
      cell,
      cell,
    )
    c.width = c.height = 0
  })
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

/** Can this browser put an image on the clipboard? (Needs HTTPS and `ClipboardItem`.) */
export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'
}

/**
 * The clipboard takes PNG and little else (Safari and Firefox refuse a JPEG),
 * so a JPEG still is re-encoded through a canvas. Keeping PNG also keeps a
 * transparent gap fill transparent on the way in.
 */
async function pngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png')
    return blob
  const url = URL.createObjectURL(blob)
  try {
    return await pngFromUrl(url)
  }
  finally {
    URL.revokeObjectURL(url)
  }
}

/** Decode one already-object-URL image, draw it 1:1, and hand back a PNG. */
async function pngFromUrl(url: string): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new Image()
    el.onload = () => res(el)
    el.onerror = () => rej(new Error('Failed to decode the image'))
    el.src = url
  })
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  if (!ctx)
    throw new Error('Failed to get a 2D context')
  ctx.drawImage(img, 0, 0)
  const png = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))
  if (!png)
    throw new Error('Failed to encode the image')
  return png
}

/**
 * Copy an image to the clipboard. The `ClipboardItem` is built and `write()`
 * called before the PNG encode resolves, on purpose: Safari only holds the
 * user-gesture permission while the item is being constructed, and every
 * implementation accepts a promise as the item's value.
 */
export async function copyImageToClipboard(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(blob) })])
}
