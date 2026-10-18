import type { BgImage } from './collageBg'
import type { FilterValue } from './filters'
import type { FontMeta } from './fonts'
import type { FullSource, FullSourceBatch, Photo } from './imageStore'
import type { CornerRadii, Leaf, Node, PaneLabel, PaneTransform, Rect, SeamSides, Sticker } from './panes'
import { mapSeq } from './async'
import { isTransparentBg, paintCollageBg } from './collageBg'
import { applyFilter, filterKey, filterSeed, resolveFilter } from './filters'
import { ensureFonts, fontById, measureLabel, normalLineHeightRatio } from './fonts'
import { t } from './i18n'
import { acquireFullBatch } from './imageStore'
import { LABEL_ICON_EM, LABEL_ICON_GAP_EM, labelIconNode, loadLabelIcon } from './labelIcons'
import { labelPreviewUnit } from './labelMetrics'
import { blendFadePx, boardStickerRect, expandRectForBlend, labelAlign, labelAlignOffset, labelPaint, labelRect, labelTextLines, layoutTree, leafCornerRadii, leafList, paneTransform, placement, rotationOf, seamFadeWidth, seamSides } from './panes'
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
  edgeFade: number
  edgeFadeStrength: number
  /** Opt-in overlap crossfade; default backdrop feather when false/omitted. */
  blendCrossfade?: boolean
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
  /** Effective fade width; crossfade mode also scales by strength and gap. */
  fade: number
  /** True when opt-in overlap + lighter crossfade is active. */
  crossfade: boolean
  seam: Map<string, SeamSides>
  /** `rect` is the draw box (expanded when crossfade); `layout` is the layout cell. */
  cells: { leaf: Leaf, rect: Rect, layout: Rect, photo: Photo }[]
  labels: PaneLabel[]
}

function prepare(opts: ExportOptions, W: number, H: number): Prepared {
  const u = Math.min(W, H) / 1000
  const gap = opts.gap * u
  const l = layoutTree(opts.root, W, H, gap)
  const crossfade = !!opts.blendCrossfade
  // Crossfade: neighbors overlap by fade (gap>0 skips). Backdrop: raw EDGE_FADE width.
  const fade = crossfade
    ? blendFadePx(opts.edgeFade * u, opts.edgeFadeStrength, gap)
    : opts.edgeFade * u
  // Always resolve seams: gap=0 corner squaring needs them even without fade.
  const seam = seamSides(l.leaves, gap)
  const cells: Prepared['cells'] = []
  for (const { node, rect } of l.leaves) {
    if (!node.photoId)
      continue
    const photo = opts.photos.get(node.photoId)
    if (!photo?.trueW)
      continue
    const sides = seam.get(node.id)
    cells.push({
      leaf: node,
      layout: rect,
      rect: crossfade ? expandRectForBlend(rect, sides, fade) : rect,
      photo,
    })
  }
  return {
    W,
    H,
    u,
    gap,
    radius: opts.radius * u,
    fade,
    crossfade,
    seam,
    cells,
    labels: (opts.labels ?? []).filter(l => l.text.trim()),
  }
}

/**
 * Turn `ctx` the way the pane's photo is framed: about `center`, scaled by the
 * flip signs and the cover factor (`paneTransform`). An upright, unflipped pane
 * passes identity values, which compose to no change at all.
 */
function applyPaneTurn(ctx: CanvasRenderingContext2D, center: { x: number, y: number }, t: PaneTransform) {
  ctx.translate(center.x, center.y)
  ctx.rotate(t.rot)
  ctx.scale(t.scaleX, t.scaleY)
  ctx.translate(-center.x, -center.y)
}

/**
 * The photo's pixels with its texture filter baked in, at the photo's own
 * resolution. Both directions matter and both are chosen, not incidental:
 *
 * - the filter runs on the whole source frame BEFORE placement, so its grain,
 *   plates and dither are anchored to the photo and pan / zoom / rotate with
 *   it, so the texture is printed on the photo and not on the pane;
 * - it runs at the source resolution, and `lib/filters` scales its parameters
 *   to the image, so a 2048px export and a 1024px preview carry the same
 *   texture at their own pixel sizes.
 *
 * One canvas per (photo, filter) per export run: several panes can hold the
 * same photo, and the filter is not free.
 */
export function filteredSource(src: CanvasImageSource, w: number, h: number, filter: FilterValue, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  applyFilter(img, filter, seed)
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** What a paint draws for one pane: the photo, filtered when the pane asks. */
type PaintSource = (photo: Photo, leaf: Leaf) => CanvasImageSource | null

/**
 * Draw one placed photo into its pane: turned and mirrored as the pane frames
 * it, feathered along the seam edges when it has any.
 *
 * The feather belongs to the PANE, not the photo, so a framed photo is first
 * painted (turned) into a pane-sized scratch, the seam gradients then mask that
 * scratch in pane space, and the result is stamped into the pane rect. That is
 * the preview's order too: the masks ride the clip wrapper and the turn rides a
 * layer inside it. The caller's roundRect clip still rounds the corners.
 */
function drawPanePhoto(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  p: { x: number, y: number, w: number, h: number },
  rect: Rect,
  leaf: Leaf,
  seam: SeamSides | undefined,
  fade: number,
) {
  const turn = paneTransform(rect, leaf)
  const fw = seam ? seamFadeWidth(fade, rect) : 0
  if (!seam || fw <= 0) {
    ctx.save()
    applyPaneTurn(ctx, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, turn)
    ctx.drawImage(src, p.x, p.y, p.w, p.h)
    ctx.restore()
    return
  }
  const cw = Math.max(1, Math.ceil(rect.w))
  const ch = Math.max(1, Math.ceil(rect.h))
  const scratch = document.createElement('canvas')
  scratch.width = cw
  scratch.height = ch
  const sc = scratch.getContext('2d')!
  sc.imageSmoothingQuality = 'high'
  // The scratch is the pane box shifted by -rect.x/-rect.y, so the pane center
  // sits at half its size: turning there turns about the same point the
  // unfeathered path and the preview turn about.
  applyPaneTurn(sc, { x: rect.w / 2, y: rect.h / 2 }, turn)
  sc.drawImage(src, p.x - rect.x, p.y - rect.y, p.w, p.h)
  sc.globalCompositeOperation = 'destination-in'
  const solid = 'rgba(0,0,0,1)'
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
 * The shared blurred backdrop field (backdrop mode): every photo painted
 *  unclipped and blurred behind the panes, so their feathered edges melt
 *  into one continuous field. Mirrors the preview's SeamBackdrop layer.
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, prep: Prepared, opts: ExportOptions, paint: PaintSource) {
  if (typeof ctx.filter !== 'string' || prep.fade <= 0)
    return
  const R = Math.max(prep.u * 40, prep.fade)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, opts.edgeFadeStrength / 100))
  for (const { leaf, layout, photo } of prep.cells) {
    // Only panes that face another photo-bearing pane contribute to the
    // blurred backdrop; otherwise the backdrop would bleed into (and fill)
    // empty neighboring panes.
    const seam = prep.seam.get(leaf.id)
    if (!seam || !(seam.left || seam.right || seam.top || seam.bottom))
      continue
    // The backdrop is the pane's photo blurred, so it takes the filter too: a
    // filtered pane must not melt into an unfiltered halo.
    const paintSrc = paint(photo, leaf)
    if (!paintSrc)
      continue
    // Deliberately untransformed: the backdrop is the blurred field behind the
    // panes, and the preview's own backdrop layer (Stage.tsx) does not turn
    // either. One of the two turning alone would put them out of step.
    const p = placement(layout, leaf, photo.trueW, photo.trueH)
    ctx.save()
    ctx.filter = `blur(${R}px)`
    ctx.drawImage(paintSrc, p.x, p.y, p.w, p.h)
    ctx.restore()
  }
  ctx.restore()
}

/**
 * Clip each photo into its pane and draw it placed (feathered at seams).
 * Board stickers are drawn later, unclipped.
 */
function drawPhotoCells(ctx: CanvasRenderingContext2D, prep: Prepared, _opts: ExportOptions, paint: PaintSource) {
  // Crossfade: complementary alphas add (source-over would darken under the fade).
  if (prep.crossfade && prep.fade > 0)
    ctx.globalCompositeOperation = 'lighter'
  for (const { leaf, rect, layout, photo } of prep.cells) {
    const paintSrc = paint(photo, leaf)
    if (!paintSrc)
      continue
    const p = placement(layout, leaf, photo.trueW, photo.trueH)
    const seam = prep.seam.get(leaf.id)
    ctx.save()
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, leafCornerRadii(prep.radius, seam, prep.gap))
    ctx.clip()
    drawPanePhoto(ctx, paintSrc, p, rect, leaf, seam, prep.fade)
    ctx.restore()
  }
  if (prep.crossfade && prep.fade > 0)
    ctx.globalCompositeOperation = 'source-over'
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

export interface LabelLinePlacement {
  text: string
  /** Layout width of the line, from canvas metrics. */
  w: number
  ascent: number
  descent: number
  lineH: number
  halfLead: number
  /** Absolute board px where this line's text starts. */
  x: number
  /** Absolute board px baseline. */
  baseline: number
}

export interface LabelLayout {
  box: Rect
  blockW: number
  blockH: number
  iconW: number
  /** Absolute board px where the text block (after the icon) starts. */
  left: number
  fontPx: number
  meta: FontMeta
  lines: LabelLinePlacement[]
}

/**
 * The one layout both the preview (through CSS) and the exporter draw: one
 * measured line box per explicit newline, a block as wide as the widest line,
 * and the icon slot before it. Exported so the browser parity check can read
 * the exact per-line x the canvas will draw at, rather than re-deriving it.
 */
export function labelLineLayout(lab: PaneLabel, board: Rect, unit: number, withIcon = !!labelIconNode(lab.icon), measureUnit = labelPreviewUnit() || unit): LabelLayout {
  const meta = fontById(lab.font)
  const fontPx = lab.size * unit
  // Measure at the preview's px size, then scale the metrics to export px:
  // the system font's advances are not linear in size (see lib/labelMetrics).
  const measurePx = lab.size * measureUnit
  const k = fontPx / measurePx
  const lines = labelTextLines(lab.text).map((line) => {
    const m = measureLabel(meta, measurePx, line)
    // Reproduce the DOM preview's `line-height: normal` line box exactly:
    // box height = measured line box, baseline offset follows the half-leading model.
    const lineH = normalLineHeightRatio(meta, line) * fontPx || (m.fontAscent + m.fontDescent) * k || fontPx * 1.2
    return {
      text: line,
      w: m.w * k,
      ascent: m.fontAscent * k,
      descent: m.fontDescent * k,
      lineH,
      halfLead: Math.max(0, (lineH - (m.fontAscent + m.fontDescent) * k) / 2),
      x: 0,
      baseline: 0,
    }
  })
  const blockW = Math.max(0, ...lines.map(l => l.w))
  const blockH = lines.reduce((sum, l) => sum + l.lineH, 0)
  // Mirror the DOM's flex row: [icon][gap][text], all centered vertically.
  const iconW = withIcon ? fontPx * (LABEL_ICON_EM + LABEL_ICON_GAP_EM) : 0
  const box = labelRect(board, lab, blockW + iconW, blockH, fontPx)
  const left = box.x + fontPx * 0.38
  const align = labelAlign(lab)
  let top = box.y + fontPx * 0.22
  for (const line of lines) {
    line.x = left + iconW + labelAlignOffset(align, blockW, line.w)
    line.baseline = top + line.halfLead + line.ascent
    top += line.lineH
  }
  return { box, blockW, blockH, iconW, left, fontPx, meta, lines }
}

function drawLabel(ctx: CanvasRenderingContext2D, prep: Prepared, lab: PaneLabel, board: Rect, icon?: HTMLImageElement) {
  const layout = labelLineLayout(lab, board, prep.u, !!icon)
  const { box: r, fontPx, meta, lines, left } = layout
  const colors = labelPaint(lab)
  // Every placement is absolute board px; the box is drawn about its center
  // (where the label rotation pivots), so bring them back into that frame.
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rotationOf(lab))
  ctx.fillStyle = colors.fill
  ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h)
  if (icon) {
    const s = fontPx * LABEL_ICON_EM
    ctx.drawImage(icon, left - cx, -s / 2, s, s)
  }
  ctx.fillStyle = colors.fg
  ctx.font = `400 ${fontPx}px ${meta.cssStack}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const line of lines) {
    if (line.text)
      ctx.fillText(line.text, line.x - cx, line.baseline - cy)
  }
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
    // Filtered sources, one per (photo, filter): baked once per run and reused
    // by every pane holding that pair. Released with the batch below.
    const filtered = new Map<string, HTMLCanvasElement>()
    const paint: PaintSource = (photo, leaf) => {
      const full = src.get(photo)
      if (!full)
        return null
      // A saved file from a newer build may name a filter this one lacks.
      const spec = resolveFilter(leaf.filter)
      if (!spec)
        return full.src
      const key = `${photo.id}|${filterKey(spec)}`
      let canvas = filtered.get(key)
      if (!canvas) {
        canvas = filteredSource(full.src, full.w, full.h, spec, filterSeed(photo.id, spec.id))
        filtered.set(key, canvas)
      }
      return canvas
    }
    // Whole-collage background layers, under everything the panes paint.
    paintCollageBg(ctx, W, H, { bg: opts.bg, gradient: opts.bgGradient ?? null, image: opts.bgImage ?? null }, (bgPhoto && src.get(bgPhoto)) || null)
    // Backdrop feather (default) or overlap crossfade (opt-in).
    if (!prep.crossfade)
      drawBackdrop(ctx, prep, opts, paint)
    drawPhotoCells(ctx, prep, opts, paint)
    drawBoardStickers(ctx, prep, stickers, opts.photos, src)
    await ensureLabelFonts(prep)
    drawLabels(ctx, prep, await loadLabelIcons(prep))
    for (const canvas of filtered.values())
      canvas.width = canvas.height = 0
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

/**
 * One live cell's video frame clipped into its pane; board inserts are redrawn
 * by the frame loop. The paused still the frame loop starts from carries the
 * pane's texture filter; the moving video does not (`lib/filters` runs on a
 * still's pixels, and a per-frame pass at 30fps is not worth the hit). A
 * filtered Live Photo therefore exports as unfiltered video over a filtered
 * board.
 */
function drawLiveCell(
  ctx: CanvasRenderingContext2D,
  prep: Prepared,
  cell: Prepared['cells'][number],
  v: HTMLVideoElement,
  _opts: ExportOptions,
  _src: Map<Photo, FullSource | null>,
) {
  const { leaf, rect, layout } = cell
  const p = placement(layout, leaf, v.videoWidth, v.videoHeight)
  const seam = prep.seam.get(leaf.id)
  ctx.save()
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, leafCornerRadii(prep.radius, seam, prep.gap))
  ctx.clip()
  drawPanePhoto(ctx, v, p, rect, leaf, seam, prep.fade)
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
  edgeFade: number
  edgeFadeStrength: number
  /** Opt-in overlap crossfade; default backdrop feather when false/omitted. */
  blendCrossfade?: boolean
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
    edgeFade: opts.edgeFade,
    edgeFadeStrength: opts.edgeFadeStrength,
    blendCrossfade: opts.blendCrossfade,
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

  // The framing (pan / zoom) is reported as it is stored. A rotated or flipped
  // pane's visible crop is that frame turned, which a `magick -crop` line cannot
  // express, so a framed pane's row is the crop before its turn.
  prep.cells.forEach(({ leaf, layout, photo }, i) => {
    const p = placement(layout, leaf, photo.trueW, photo.trueH)
    let sx = Math.round((layout.x - p.x) / p.scale)
    let sy = Math.round((layout.y - p.y) / p.scale)
    let sw = Math.round(layout.w / p.scale)
    let sh = Math.round(layout.h / p.scale)
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
