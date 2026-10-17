import type { BgImage } from './collageBg'
import type { FullSource, FullSourceBatch, Photo } from './imageStore'
import type { CornerRadii, Leaf, Node, PaneLabel, Rect, SeamSides, Sticker } from './panes'
import { isTransparentBg } from '../store'
import { mapSeq } from './async'
import { paintCollageBg } from './collageBg'
import { ensureFonts, fontById, measureLabel, normalLineHeightRatio } from './fonts'
import { t } from './i18n'
import { acquireFullBatch } from './imageStore'
import { LABEL_ICON_EM, LABEL_ICON_GAP_EM, labelIconNode, loadLabelIcon } from './labelIcons'
import { boardStickerRect, labelPaint, labelRect, layoutTree, leafCornerRadii, leafList, placement, rotationOf, seamSides } from './panes'
import { say } from './toast'

export interface ExportOptions {
  root: Node
  ratio: number
  gap: number
  radius: number
  bg: string
  /** Whole-collage background layers over `bg` (see lib/collageBg). */
  bgGradient?: string | null
  bgImage?: BgImage | null
  photos: Map<string, Photo>
  longSide: number
  /** Board-level stickers (canvas-normalized). */
  stickers?: Sticker[]
  /** Board-level text labels (canvas-normalized). */
  labels?: PaneLabel[]
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

/**
 * The pane gap in whole pixels, scaled from the store's short-edge percentage.
 * Whole pixels on purpose: every pane edge then lands on a pixel boundary, so
 * adjacent panes tile the canvas exactly instead of splitting a pixel with the
 * clip's anti-aliasing (which is what a hairline seam is).
 */
export function exportGap(gapSetting: number, W: number, H: number): number {
  return Math.round(gapSetting * Math.min(W, H) / 1000)
}

function clampCorner(r: number, w: number, h: number) {
  return Math.max(0, Math.min(r, w / 2, h / 2))
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number | CornerRadii,
) {
  const src: CornerRadii = typeof radii === 'number'
    ? [radii, radii, radii, radii]
    : radii
  const tl = clampCorner(src[0], w, h)
  const tr = clampCorner(src[1], w, h)
  const br = clampCorner(src[2], w, h)
  const bl = clampCorner(src[3], w, h)
  c.beginPath()
  if (typeof c.roundRect === 'function') {
    c.roundRect(x, y, w, h, [tl, tr, br, bl])
    return
  }
  c.moveTo(x + tl, y)
  c.lineTo(x + w - tr, y)
  c.arcTo(x + w, y, x + w, y + tr, tr)
  c.lineTo(x + w, y + h - br)
  c.arcTo(x + w, y + h, x + w - br, y + h, br)
  c.lineTo(x + bl, y + h)
  c.arcTo(x, y + h, x, y + h - bl, bl)
  c.lineTo(x, y + tl)
  c.arcTo(x, y, x + tl, y, tl)
  c.closePath()
}

interface Prepared {
  W: number
  H: number
  u: number
  gap: number
  radius: number
  seam: Map<string, SeamSides>
  /** `rect` is the layout cell: the exact box the pane's photo is clipped to. */
  cells: { leaf: Leaf, rect: Rect, photo: Photo }[]
  labels: PaneLabel[]
}

/**
 * Resolve the export's geometry. The gap is whole pixels on purpose: pane
 * edges then land on pixel boundaries, so adjacent panes tile the canvas
 * exactly and no clip edge falls inside a pixel (see `snappedSplit`).
 */
function prepare(opts: ExportOptions, W: number, H: number): Prepared {
  const u = Math.min(W, H) / 1000
  const gap = exportGap(opts.gap, W, H)
  const l = layoutTree(opts.root, W, H, gap)
  // Seams tell the clip which corners are shared, so gap=0 panes keep square
  // inner corners and only the outside of the collage stays rounded.
  const seam = seamSides(l.leaves, gap)
  const cells: Prepared['cells'] = []
  for (const { node, rect } of l.leaves) {
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
    seam,
    cells,
    labels: (opts.labels ?? []).filter(l => l.text.trim()),
  }
}

/** Every photo a collage paint will draw, cells first then their stickers, deduped. */
function paintPhotos(prep: Prepared, photos: Map<string, Photo>, stickers: Sticker[] = [], bgPhoto?: Photo): Photo[] {
  const wanted: Photo[] = bgPhoto ? [bgPhoto] : []
  for (const { photo } of prep.cells)
    wanted.push(photo)
  for (const st of stickers) {
    const sp = photos.get(st.photoId)
    if (sp?.trueW && sp.trueH)
      wanted.push(sp)
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
 * Clip each photo into its pane and draw it placed. Panes are drawn opaque
 *  and flush: the layout already tiles the canvas exactly, so the boundaries
 *  between photos are a single crisp pixel edge with nothing to feather.
 */
function drawPhotoCells(ctx: CanvasRenderingContext2D, prep: Prepared, src: Map<Photo, FullSource | null>) {
  for (const { leaf, rect, photo } of prep.cells) {
    const full = src.get(photo)
    if (!full)
      continue
    const p = placement(rect, leaf, photo.trueW, photo.trueH)
    ctx.save()
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, leafCornerRadii(prep.radius, prep.seam.get(leaf.id), prep.gap))
    ctx.clip()
    ctx.drawImage(full.src, p.x, p.y, p.w, p.h)
    ctx.restore()
  }
}

/** Draw board-level stickers over the whole collage (not clipped to panes). */
function drawBoardStickers(
  ctx: CanvasRenderingContext2D,
  prep: Prepared,
  stickers: Sticker[],
  photos: Map<string, Photo>,
  src: Map<Photo, FullSource | null>,
) {
  const board = { w: prep.W, h: prep.H }
  for (const st of stickers) {
    const sp = photos.get(st.photoId)
    if (!sp?.trueW || !sp.trueH)
      continue
    const full = src.get(sp)
    if (!full)
      continue
    const sr = boardStickerRect(board, st, sp.trueW / sp.trueH)
    ctx.save()
    ctx.translate(sr.x + sr.w / 2, sr.y + sr.h / 2)
    ctx.rotate(rotationOf(st))
    ctx.drawImage(full.src, -sr.w / 2, -sr.h / 2, sr.w, sr.h)
    ctx.restore()
  }
}

/** Load the fonts any label needs; warn when some fell back to system. */
async function ensureLabelFonts(prep: Prepared) {
  if (!prep.labels.length)
    return
  const ids = [...new Set(prep.labels.map(l => l.font))]
  const failed = await ensureFonts(ids)
  if (failed.length) {
    const names = failed.map(id => fontById(id).label).join(', ')
    say(t('Fonts unavailable, used system fallback: {names}', { names }))
  }
}

type LabelIcons = Map<string, HTMLImageElement>

/** Rasterize each label's icon once, in its text color, keyed by label id. */
async function loadLabelIcons(prep: Prepared): Promise<LabelIcons> {
  const out: LabelIcons = new Map()
  await Promise.all(prep.labels.map(async (lab) => {
    const node = labelIconNode(lab.icon)
    const img = node && await loadLabelIcon(node, labelPaint(lab).fg)
    if (img)
      out.set(lab.id, img)
  }))
  return out
}

/** Board labels draw on top of everything, unclipped, in canvas-normalized coords. */
function drawLabels(ctx: CanvasRenderingContext2D, prep: Prepared, icons: LabelIcons) {
  const board: Rect = { x: 0, y: 0, w: prep.W, h: prep.H }
  for (const lab of prep.labels)
    drawLabel(ctx, prep, lab, board, icons.get(lab.id))
}

function drawLabel(ctx: CanvasRenderingContext2D, prep: Prepared, lab: PaneLabel, board: Rect, icon?: HTMLImageElement) {
  const meta = fontById(lab.font)
  const fontPx = lab.size * prep.u
  const m = measureLabel(meta, fontPx, lab.text)
  // Reproduce the DOM preview's `line-height: normal` line box exactly:
  // box height = measured line box, baseline offset follows the half-leading model.
  const lineH = normalLineHeightRatio(meta, lab.text) * fontPx || (m.fontAscent + m.fontDescent)
  const halfLead = Math.max(0, (lineH - (m.fontAscent + m.fontDescent)) / 2)
  // Mirror the DOM's flex row: [icon][gap][text], all centered vertically.
  const iconW = icon ? fontPx * (LABEL_ICON_EM + LABEL_ICON_GAP_EM) : 0
  const r = labelRect(board, lab, m.w + iconW, lineH, fontPx)
  const colors = labelPaint(lab)
  ctx.save()
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
  ctx.rotate(rotationOf(lab))
  ctx.fillStyle = colors.fill
  ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h)
  const left = -r.w / 2 + fontPx * 0.38
  if (icon) {
    const s = fontPx * LABEL_ICON_EM
    ctx.drawImage(icon, left, -s / 2, s, s)
  }
  ctx.fillStyle = colors.fg
  ctx.font = `400 ${fontPx}px ${meta.cssStack}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(lab.text, left + iconW, -r.h / 2 + fontPx * 0.22 + halfLead + m.fontAscent)
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
    const stickers = opts.stickers ?? []
    const bgPhoto = opts.bgImage ? opts.photos.get(opts.bgImage.photoId) : undefined
    const src = await resolveSources(paintPhotos(prep, opts.photos, stickers, bgPhoto), sources)
    // Whole-collage background layers, under everything the panes paint.
    paintCollageBg(ctx, W, H, { bg: opts.bg, gradient: opts.bgGradient ?? null, image: opts.bgImage ?? null }, (bgPhoto && src.get(bgPhoto)) || null)
    drawPhotoCells(ctx, prep, src)
    drawBoardStickers(ctx, prep, stickers, opts.photos, src)
    await ensureLabelFonts(prep)
    drawLabels(ctx, prep, await loadLabelIcons(prep))
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
 *  MOV over the rendered still: the still carries layout, labels
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
      const labelIcons = await loadLabelIcons(prep)

      const drawFrame = () => {
        ctx.drawImage(still, 0, 0)
        for (const { cell, v } of vids)
          drawLiveCell(ctx, prep, cell, v, opts, src)
        drawBoardStickers(ctx, prep, opts.stickers ?? [], opts.photos, src)
        drawLabels(ctx, prep, labelIcons)
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
function stickerPhotos(_vids: LiveVid[], opts: ExportOptions): Photo[] {
  const wanted: Photo[] = []
  for (const st of opts.stickers ?? []) {
    const sp = opts.photos.get(st.photoId)
    if (sp?.trueW)
      wanted.push(sp)
  }
  return [...new Set(wanted)]
}

/** One live cell's video frame clipped into its pane; board inserts are redrawn by the frame loop. */
function drawLiveCell(
  ctx: CanvasRenderingContext2D,
  prep: Prepared,
  cell: Prepared['cells'][number],
  v: HTMLVideoElement,
  _opts: ExportOptions,
  _src: Map<Photo, FullSource | null>,
) {
  const { leaf, rect } = cell
  const p = placement(rect, leaf, v.videoWidth, v.videoHeight)
  ctx.save()
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, leafCornerRadii(prep.radius, prep.seam.get(leaf.id), prep.gap))
  ctx.clip()
  ctx.drawImage(v, p.x, p.y, p.w, p.h)
  ctx.restore()
}

// --- Grid snapshot ------------------------------------------------------

/**
 * The overview's largest cell, in px (the WorkspaceGrid cell clamp). The board
 * snapshot scales its cell gap from the same reference, so the image keeps the
 * on-screen proportions at any resolution.
 */
export const GRID_CELL_MAX = 220

export interface GridSnapshotOptions {
  /** The workspaces in grid order (1–9); anything past 9 is ignored. */
  workspaces: { root: Node, canvasRatio: number | null, stickers?: Sticker[], labels?: PaneLabel[] }[]
  /** Long edge of the finished board, in px: each cell gets about a third. */
  longSide: number
  /** Space between the overview cells, in px (the store's grid gap). */
  gridGap: number
  radius: number
  bg: string
  photos: Map<string, Photo>
  /** Cell width / height (the grid's cell aspect); 1 = square. */
  cellRatio?: number
}

type GridWs = GridSnapshotOptions['workspaces'][number]

/** One grid cell as its own canvas: the collage cover-fit and cropped to w×h, like CellPreview. */
async function renderGridCell(ws: GridWs, w: number, h: number, opts: GridSnapshotOptions): Promise<HTMLCanvasElement> {
  const ratio = ws.canvasRatio ?? 1.5
  // Large enough to cover the cell, like CellPreview's cover-fit scale.
  const k = Math.max(w, h * ratio, 1)
  const c = await renderCollage({
    root: ws.root,
    ratio,
    // The overview lays its previews out flush (no pane gap).
    gap: 0,
    radius: opts.radius,
    bg: opts.bg,
    photos: opts.photos,
    longSide: Math.round(Math.max(k, k / ratio)),
    stickers: ws.stickers ?? [],
    labels: ws.labels ?? [],
  })
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  const s = Math.max(w / c.width, h / c.height)
  const sw = w / s
  const sh = h / s
  ctx.drawImage(c, (c.width - sw) / 2, (c.height - sh) / 2, sw, sh, 0, 0, w, h)
  c.width = c.height = 0
  return out
}

/** Cell px size for a grid export at `longSide` (about a third per cell). */
export function gridCellPx(longSide: number, cellRatio = 1): { w: number, h: number } {
  const long = Math.max(240, Math.round(longSide / 3))
  return cellRatio >= 1 ? { w: long, h: Math.round(long / cellRatio) } : { w: Math.round(long * cellRatio), h: long }
}

/**
 * Every filled cell as its own image, in grid (posting) order, cropped to the
 * grid's cell aspect. Each canvas is handed to `onCell` and may be released there.
 */
export async function renderGridCells(opts: GridSnapshotOptions, onCell: (canvas: HTMLCanvasElement, i: number, total: number) => Promise<void>): Promise<void> {
  const { w, h } = gridCellPx(opts.longSide, opts.cellRatio)
  const filled = opts.workspaces.slice(0, 9).filter(ws => leafList(ws.root).some(l => l.photoId))
  await mapSeq(filled, async (ws, i) => {
    await onCell(await renderGridCell(ws, w, h, opts), i, filled.length)
  })
}

/**
 * The grid overview as one image: the same square cells the grid draws (three
 * to a row, the last row may be short; the + cell is not part of it),
 * cover-fit and laid out with the grid gap on the collage background. A cell
 * renders like its preview, panes flushed and the collage's short edge mapped
 * onto the cell, then the cover overflow is cropped away; empty cells stay
 * blank (the background, or nothing at all while the gap fill is transparent).
 */
export async function renderGridSnapshot(opts: GridSnapshotOptions): Promise<HTMLCanvasElement> {
  const { w, h } = gridCellPx(opts.longSide, opts.cellRatio)
  const gap = Math.round(opts.gridGap * Math.max(w, h) / GRID_CELL_MAX)
  const list = opts.workspaces.slice(0, 9)
  const cols = Math.max(1, Math.min(3, list.length))
  const rows = Math.max(1, Math.ceil(list.length / 3))
  const canvas = document.createElement('canvas')
  canvas.width = w * cols + gap * (cols - 1)
  canvas.height = h * rows + gap * (rows - 1)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  if (!isTransparentBg(opts.bg)) {
    ctx.fillStyle = opts.bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  // Up to nine full-resolution collage renders, each drawn into the reused
  // grid canvas in cell order; the first failure aborts the snapshot.
  await mapSeq(list, async (ws, i) => {
    if (!leafList(ws.root).some(l => l.photoId))
      return
    const c = await renderGridCell(ws, w, h, opts)
    ctx.drawImage(c, (i % 3) * (w + gap), Math.floor(i / 3) * (h + gap))
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
