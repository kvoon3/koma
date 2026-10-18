import type { ExportOptions } from './exporter'
import type { RenderedItem } from './exportRun'
import { activeWs, isTransparentBg, photoMap, useStore } from '../store'
import { mapSeq } from './async'
import { computeExportSize, hasLiveCells, renderCollage, renderCollageVideo, renderGridCells, renderGridSnapshot } from './exporter'
import { cellRatioValue, gridCellFileName } from './gridTools'
import { t } from './i18n'
import { leafList } from './panes'
import { say } from './toast'

/**
 * The export orchestration behind the dialog: it reads the store, draws
 * through `lib/exporter` and hands back finished items. No React here; the
 * router's chrome only calls these and shows the result.
 */

export function exportOptions(): ExportOptions {
  const s = useStore.getState()
  const ws = activeWs(s)
  return {
    root: ws.root,
    ratio: ws.canvasRatio ?? 1.5,
    gap: s.gap,
    radius: s.radius,
    bg: s.bg,
    bgGradient: s.bgGradient,
    bgImage: s.bgImage,
    edgeFade: s.edgeFade,
    edgeFadeStrength: s.edgeFadeStrength,
    blendCrossfade: s.blendCrossfade,
    photos: photoMap(s.photos),
    longSide: s.longSide,
    stickers: ws.stickers ?? [],
    labels: ws.labels ?? [],
  }
}

/** A canvas as a downloadable file: PNG carries the transparent gap fill, else the export format. */
async function canvasBlob(canvas: HTMLCanvasElement): Promise<{ blob: Blob, ext: 'png' | 'jpg' }> {
  const s = useStore.getState()
  const format = isTransparentBg(s.bg) ? 'image/png' : s.format
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, format, s.quality))
  if (!blob)
    throw new Error('Failed to create image')
  return { blob, ext: format === 'image/png' ? 'png' : 'jpg' }
}

/** `MMDDHHmm`, the stamp every export file name carries. */
function exportStamp(): string {
  return new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
}

/** One export per non-empty workspace, in grid order, named by position. */
export async function renderGridItems(): Promise<RenderedItem[]> {
  const s = useStore.getState()
  const filled = s.workspaces.filter(w => leafList(w.root).some(l => l.photoId))
  return (await mapSeq(filled, async (ws, i) => {
    say(t('Rendering {n} / {total}...', { n: i + 1, total: filled.length }))
    const opts: ExportOptions = {
      root: ws.root,
      ratio: ws.canvasRatio ?? 1.5,
      gap: s.gap,
      radius: s.radius,
      bg: s.bg,
      bgGradient: s.bgGradient,
      bgImage: s.bgImage,
      edgeFade: s.edgeFade,
      edgeFadeStrength: s.edgeFadeStrength,
      blendCrossfade: s.blendCrossfade,
      photos: photoMap(s.photos),
      longSide: s.longSide,
      stickers: ws.stickers ?? [],
      labels: ws.labels ?? [],
    }
    // Position among the filled workspaces at export time, 1-based.
    const pos = s.workspaces.indexOf(ws) + 1
    // One workspace at a time: each pass paints a full-resolution canvas and
    // may record a Live Photo video, and each pass releases its canvases
    // before the next one starts.
    const canvas = await renderCollage(opts)
    const base = `collage_${pos}_${canvas.width}x${canvas.height}_${exportStamp()}`
    // The still's encode and the live recording only read the canvas, so
    // they run together; both finish before the canvas is released.
    const [still, live] = await Promise.all([
      itemFromCanvas(canvas, base, pos),
      renderLiveVideoItem(opts, canvas, base, pos),
    ])
    canvas.width = canvas.height = 0
    return live ? [still, live] : [still]
  })).flat()
}

/** The whole 3×3 board as one image (grid_all), leading the per-cell run. */
async function renderGridSnapshotItem(stamp: string): Promise<RenderedItem> {
  const s = useStore.getState()
  const canvas = await renderGridSnapshot({
    workspaces: s.workspaces,
    longSide: s.longSide,
    gridGap: s.gridGap,
    radius: s.radius,
    bg: s.bg,
    edgeFade: s.edgeFade,
    edgeFadeStrength: s.edgeFadeStrength,
    blendCrossfade: s.blendCrossfade,
    photos: photoMap(s.photos),
    cellRatio: cellRatioValue(s.gridCellRatio),
  })
  const item = await itemFromCanvas(canvas, `grid_all_${stamp}`)
  canvas.width = canvas.height = 0
  return item
}

/**
 * The grid snapshot run: every filled cell as its own image, cropped to the
 * cell aspect and named in posting order (grid_01_of_09 …) for a 9-grid post,
 * with the whole board as one image (grid_all) first.
 */
export async function renderGridCellItems(): Promise<RenderedItem[]> {
  const s = useStore.getState()
  const stamp = exportStamp()
  const items: RenderedItem[] = []
  await renderGridCells({
    workspaces: s.workspaces,
    longSide: s.longSide,
    gridGap: s.gridGap,
    radius: s.radius,
    bg: s.bg,
    edgeFade: s.edgeFade,
    edgeFadeStrength: s.edgeFadeStrength,
    blendCrossfade: s.blendCrossfade,
    photos: photoMap(s.photos),
    cellRatio: cellRatioValue(s.gridCellRatio),
  }, async (canvas, i, total) => {
    say(t('Rendering {n} / {total}...', { n: i + 1, total }))
    const { blob, ext } = await canvasBlob(canvas)
    items.push({ kind: 'image', blob, name: gridCellFileName(i, total, ext, stamp), w: canvas.width, h: canvas.height })
    canvas.width = canvas.height = 0
  })
  if (items.length)
    items.unshift(await renderGridSnapshotItem(stamp))
  return items
}

/** The active workspace: the still, plus the paired video when a Live Photo pane is in frame. */
export async function renderWorkspaceItems(): Promise<RenderedItem[]> {
  const opts = exportOptions()
  const canvas = await renderCollage(opts)
  const base = `collage_${canvas.width}x${canvas.height}_${exportStamp()}`
  const items = [await itemFromCanvas(canvas, base)]
  const live = await renderLiveVideoItem(opts, canvas, base)
  if (live)
    items.push(live)
  canvas.width = canvas.height = 0
  return items
}

/**
 * A rendered canvas as a previewable export item. The canvas is left alone:
 * the video recorder needs it as its first frame, so the caller releases it
 * (`canvas.width = canvas.height = 0`) once the whole run has drawn from it.
 * The preview URL is minted by the run that adopts the item (see armRun).
 */
async function itemFromCanvas(canvas: HTMLCanvasElement, stem: string, group?: number): Promise<RenderedItem> {
  const { blob, ext } = await canvasBlob(canvas)
  return {
    kind: 'image',
    blob,
    name: `${stem}.${ext}`,
    w: canvas.width,
    h: canvas.height,
    group,
  }
}

/**
 * When any pane holds a Live Photo, a run also records a video of the
 * collage with those panes playing, named to pair with the still by
 * basename (the same convention as Apple's IMG_1234.HEIC + IMG_1234.MOV).
 */
async function renderLiveVideoItem(opts: ExportOptions, still: HTMLCanvasElement, base: string, group?: number): Promise<RenderedItem | null> {
  if (!hasLiveCells(opts))
    return null
  say(t('Recording live video...'))
  const r = await renderCollageVideo(opts, still)
  if (!r) {
    say(t('Live video export is not supported in this browser'))
    return null
  }
  const { W, H } = computeExportSize(opts)
  return {
    kind: 'video',
    blob: r.blob,
    name: `${base}.${r.ext}`,
    w: W,
    h: H,
    group,
    live: true,
  }
}
