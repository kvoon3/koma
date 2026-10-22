/**
 * The music card: an opaque square PNG made from a track's artwork and the
 * lines a listener reads. Two variants, both full-bleed like Spotify's own
 * share card: Cover puts the artwork behind the title, artist and provider
 * mark; Lyrics blurs and lifts the artwork so dark type can sit on it.
 *
 * Text fitting is a pure function with the measurer injected, so the layout
 * rules (line count, shrink, ellipsis) are tested under Bun without a canvas.
 * The renderer is the browser half: it only paints what the fit decided.
 */
import type { MusicProvider } from './musicLink'
import { firstLyricLines } from './lyrics'

export const CARD_SIZE = 1024

/** The two compositions, in the order the dialog's switch shows them. */
export const MUSIC_CARD_STYLE_IDS = ['cover', 'lyrics'] as const
export type MusicCardStyle = typeof MUSIC_CARD_STYLE_IDS[number]
export const DEFAULT_MUSIC_CARD_STYLE: MusicCardStyle = 'cover'

/**
 * How far the lyric type steps with the size control. Lines wrap at every
 * step, so a larger size fills more of the window rather than overflowing it.
 */
export const LYRIC_SCALES = [0.8, 0.9, 1] as const
export type LyricScale = typeof LYRIC_SCALES[number]
export type LyricSize = 's' | 'm' | 'l'
export const LYRIC_SIZE_SCALE: Record<LyricSize, LyricScale> = { s: 0.8, m: 0.9, l: 1 }

interface Palette {
  ink: string
  muted: string
}

const COVER_COLORS: Palette = {
  ink: '#FFFFFF',
  muted: 'rgba(255, 255, 255, 0.78)',
}

const LYRIC_COLORS: Palette = {
  ink: '#121212',
  muted: 'rgba(18, 18, 18, 0.62)',
}

export const PROVIDER_COLORS: Record<MusicProvider, string> = {
  spotify: '#1DB954',
  apple: '#FA243C',
}

/** Proper nouns; the same in every locale. */
export const PROVIDER_LABELS: Record<MusicProvider, string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
}

/** A system sans; the card is offline art, never a bundled brand font. */
export const CARD_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const TEXT_X = 192
export const TITLE_MAX_W = 640
export const TITLE_MAX_SIZE = 54
export const TITLE_MIN_SIZE = 40
export const TITLE_MAX_LINES = 2
export const ARTIST_SIZE = 30

export interface TitleFit {
  lines: string[]
  /** The size the lines are drawn at, the maximum when they fit at once. */
  size: number
}

export interface TitleFitOptions {
  /** The width of the text column; defaults to the cover card's 640. */
  maxWidth?: number
  /** The largest size tried; defaults to 54. */
  maxSize?: number
  /** The size after which an ellipsis is used; defaults to 40. */
  minSize?: number
  /** How many lines the composition has room for; defaults to 2. */
  maxLines?: number
}

export type Measure = (text: string, size: number) => number

/** Trim, collapse whitespace, and treat newlines as spaces. */
function normalizeLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cut at the last character that still leaves room for the ellipsis. */
export function ellipsizeToWidth(text: string, size: number, maxWidth: number, measure: Measure): string {
  if (measure(text, size) <= maxWidth)
    return text
  return forcedEllipsis(text, size, maxWidth, measure)
}

/** Always end in an ellipsis, trimming characters until it fits. */
function forcedEllipsis(text: string, size: number, maxWidth: number, measure: Measure): string {
  let cut = text.trimEnd()
  while (cut.length > 0 && measure(`${cut}…`, size) > maxWidth)
    cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

/**
 * Greedy word wrap, with a character break for one word that cannot fit a line
 * by itself (a long CJK title has no spaces to break on). Never returns blank
 * lines.
 */
function wrapText(text: string, size: number, maxWidth: number, measure: Measure): string[] {
  const words = normalizeLine(text).split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''

  const flush = () => {
    if (line) {
      lines.push(line)
      line = ''
    }
  }

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate, size) <= maxWidth) {
      line = candidate
      continue
    }
    flush()
    let rest = word
    while (measure(rest, size) > maxWidth) {
      let cut = rest.length - 1
      while (cut > 1 && measure(rest.slice(0, cut), size) > maxWidth)
        cut--
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    line = rest
  }
  flush()
  return lines
}

/**
 * Fit a title into the composition's lines and width, shrinking from the
 * variant's maximum to its minimum before anything is ellipsized. The largest
 * size that keeps it within the line budget wins; at the minimum the last
 * visible line gets the ellipsis.
 */
export function fitTitle(text: string, measure: Measure, options: TitleFitOptions = {}): TitleFit {
  const maxWidth = options.maxWidth ?? TITLE_MAX_W
  const maxSize = options.maxSize ?? TITLE_MAX_SIZE
  const minSize = options.minSize ?? TITLE_MIN_SIZE
  const maxLines = Math.max(1, options.maxLines ?? TITLE_MAX_LINES)
  const source = normalizeLine(text)
  if (!source)
    return { lines: [], size: maxSize }

  for (let size = maxSize; size >= minSize; size--) {
    const lines = wrapText(source, size, maxWidth, measure)
    if (lines.length <= maxLines)
      return { lines, size }
  }

  const lines = wrapText(source, minSize, maxWidth, measure)
  const kept = lines.slice(0, maxLines)
  // More lines than the composition allows: the last visible one always ends
  // in an ellipsis, even when the text itself would have fit the box.
  kept[kept.length - 1] = forcedEllipsis(kept[kept.length - 1]!, minSize, maxWidth, measure)
  return { lines: kept, size: minSize }
}

/** The artist rides one line; too long is an ellipsis, never a wrap. */
export function fitArtist(
  text: string,
  measure: Measure,
  maxWidth = TITLE_MAX_W,
  size = ARTIST_SIZE,
): string {
  const source = normalizeLine(text)
  return source ? ellipsizeToWidth(source, size, maxWidth, measure) : ''
}

/**
 * A file name from the card's two lines: path separators become spaces (so
 * "AC/DC" does not invent a folder), the characters Windows refuses become
 * spaces too, and the result keeps a sane maximum rather than the library's
 * short folder-name cap. Falls back to the generic name when both are blank.
 */
export function musicCardFileName(title: string, artist: string): string {
  const clean = (s: string) => [...s]
    .map(ch => (ch.charCodeAt(0) < 0x20 ? ' ' : ch))
    .join('')
    .replace(/[/\\]/g, ' ')
    .replace(/[<>:"|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  const base = [clean(title), clean(artist)].filter(Boolean).join(' - ') || 'Music card'
  return `${base.slice(0, 180).trimEnd()}.png`
}

export interface MusicCardInput {
  provider: MusicProvider
  title: string
  artist: string
  /** The words the Lyrics variant sets; ignored by Cover. */
  lyrics?: string
  /** How far the lyric type steps; defaults to 1. */
  lyricScale?: number
  /** Defaults to `cover`; the rendered PNG carries the variant itself. */
  style?: MusicCardStyle
}

export interface LyricWindow {
  lines: string[]
  size: number
  lineHeight: number
}

export interface LyricWindowOptions {
  maxWidth?: number
  /** The type size the window is set at; defaults to 64. */
  size?: number
  /** How many display lines fit; defaults to 3. */
  maxLines?: number
  /** Line height as a multiple of the type size; defaults to 1.3. */
  ratio?: number
}

/**
 * The leading window of the lyrics at a fixed size, wrapped to the column.
 * Spotify's lyric card wraps a long phrase rather than shrinking it to an
 * unreadable size, so the window counts display lines, not source lines.
 */
export function lyricWindow(lines: string[], measure: Measure, options: LyricWindowOptions = {}): LyricWindow {
  const maxWidth = options.maxWidth ?? 848
  const size = options.size ?? 64
  const maxLines = Math.max(1, options.maxLines ?? 3)
  const ratio = options.ratio ?? 1.3
  const out: string[] = []
  for (const line of lines.map(normalizeLine).filter(Boolean)) {
    for (const part of wrapText(line, size, maxWidth, measure)) {
      if (out.length === maxLines)
        break
      out.push(part)
    }
    if (out.length === maxLines)
      break
  }
  return { lines: out, size, lineHeight: Math.round(size * ratio) }
}

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${CARD_FONT}`
}

/** A measurer bound to one weight; callers only vary the size. */
function measureFont(ctx: CanvasRenderingContext2D, weight: number): Measure {
  return (text, size) => {
    ctx.font = font(weight, size)
    return ctx.measureText(text).width
  }
}

function sourceSize(source: CanvasImageSource): { w: number, h: number } {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement && source.naturalWidth)
    return { w: source.naturalWidth, h: source.naturalHeight }
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement && source.videoWidth)
    return { w: source.videoWidth, h: source.videoHeight }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)
    return { w: source.width, h: source.height }
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement && source.width)
    return { w: source.width, h: source.height }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas)
    return { w: source.width, h: source.height }
  return { w: CARD_SIZE, h: CARD_SIZE }
}

/** Fill a square with the cover, cropping only what 1:1 cannot keep. */
function paintCover(
  ctx: CanvasRenderingContext2D,
  artwork: CanvasImageSource,
  x: number,
  y: number,
  size: number,
): void {
  const { w, h } = sourceSize(artwork)
  if (!w || !h) {
    ctx.drawImage(artwork, x, y, size, size)
    return
  }
  const scale = Math.max(size / w, size / h)
  const sw = size / scale
  const sh = size / scale
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(artwork, (w - sw) / 2, (h - sh) / 2, sw, sh, x, y, size, size)
}

function paintMark(
  ctx: CanvasRenderingContext2D,
  provider: MusicProvider,
  x: number,
  top: number,
  palette: Palette,
): void {
  const label = PROVIDER_LABELS[provider]
  ctx.font = font(600, 22)
  const dotY = top + 8

  ctx.fillStyle = PROVIDER_COLORS[provider]
  ctx.beginPath()
  ctx.arc(x + 6, dotY, 6, 0, Math.PI * 2)
  ctx.fill()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = palette.muted
  ctx.fillText(label, x + 24, dotY)
}

/* Cover: the artwork full-bleed, with the words in the lower left. */

const COVER_PAD = 112
const COVER_W = CARD_SIZE - COVER_PAD * 2
const COVER_TITLE_BOTTOM = 648
const COVER_ARTIST_TOP = 706
const COVER_MARK_TOP = 804

function drawCover(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, input: MusicCardInput): void {
  paintCover(ctx, artwork, 0, 0, CARD_SIZE)

  // A quiet base plus a bottom fade keeps white type legible over any cover.
  ctx.fillStyle = 'rgba(9, 9, 11, 0.12)'
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)

  const fade = ctx.createLinearGradient(0, 360, 0, CARD_SIZE)
  fade.addColorStop(0, 'rgba(9, 9, 11, 0)')
  fade.addColorStop(0.55, 'rgba(9, 9, 11, 0.42)')
  fade.addColorStop(1, 'rgba(9, 9, 11, 0.86)')
  ctx.fillStyle = fade
  ctx.fillRect(0, 360, CARD_SIZE, CARD_SIZE - 360)

  const measureAt = (weight: number) => measureFont(ctx, weight)
  const title = fitTitle(input.title, measureAt(700), {
    maxWidth: COVER_W,
    maxSize: 68,
    minSize: 40,
    maxLines: 2,
  })
  const artist = fitArtist(input.artist, measureAt(500), COVER_W, 32)
  const lineHeight = Math.round(title.size * 1.08)
  const titleTop = COVER_TITLE_BOTTOM - title.lines.length * lineHeight

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = COVER_COLORS.ink
  ctx.font = font(700, title.size)
  title.lines.forEach((line, i) => ctx.fillText(line, COVER_PAD, titleTop + i * lineHeight))

  if (artist) {
    ctx.fillStyle = COVER_COLORS.muted
    ctx.font = font(500, 32)
    ctx.fillText(artist, COVER_PAD, COVER_ARTIST_TOP)
  }

  paintMark(ctx, input.provider, COVER_PAD, COVER_MARK_TOP, COVER_COLORS)
}

/* Lyrics: a lifted, blurred cover with dark type, like Spotify's lyric card. */

const LYRIC_PAD = 88
const LYRIC_W = CARD_SIZE - LYRIC_PAD * 2
const LYRIC_THUMB = 88
const LYRIC_TITLE_X = LYRIC_PAD + LYRIC_THUMB + 24
const LYRIC_BLOCK_CENTER = 560
const LYRIC_MARK_TOP = 856

/** The cover, zoomed past the edges so the blur has no transparent rim. */
function paintLiftedCover(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource): void {
  const bleed = 96
  const size = CARD_SIZE + bleed * 2
  const canFilter = typeof ctx.filter === 'string'
  if (canFilter)
    ctx.filter = 'blur(30px) brightness(1.35) saturate(0.9)'
  paintCover(ctx, artwork, -bleed, -bleed, size)
  if (canFilter)
    ctx.filter = 'none'
  // Dark covers would otherwise leave dark type without contrast.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.42)'
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)
}

function paintThumbnail(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource): void {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(LYRIC_PAD, LYRIC_PAD, LYRIC_THUMB, LYRIC_THUMB, 12)
  ctx.clip()
  paintCover(ctx, artwork, LYRIC_PAD, LYRIC_PAD, LYRIC_THUMB)
  ctx.restore()
}

function drawLyrics(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, input: MusicCardInput): void {
  paintLiftedCover(ctx, artwork)
  paintThumbnail(ctx, artwork)

  const measureAt = (weight: number) => measureFont(ctx, weight)
  const title = fitTitle(input.title, measureAt(600), {
    maxWidth: CARD_SIZE - LYRIC_TITLE_X - LYRIC_PAD,
    maxSize: 36,
    minSize: 24,
    maxLines: 1,
  })
  const artist = fitArtist(input.artist, measureAt(500), CARD_SIZE - LYRIC_TITLE_X - LYRIC_PAD, 26)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  if (title.lines[0]) {
    ctx.fillStyle = LYRIC_COLORS.ink
    ctx.font = font(600, title.size)
    ctx.fillText(title.lines[0], LYRIC_TITLE_X, LYRIC_PAD + 4)
  }
  if (artist) {
    ctx.fillStyle = LYRIC_COLORS.muted
    ctx.font = font(500, 26)
    ctx.fillText(artist, LYRIC_TITLE_X, LYRIC_PAD + 52)
  }

  const window = lyricWindow(firstLyricLines(input.lyrics ?? '', 3), measureAt(600), {
    maxWidth: LYRIC_W,
    size: Math.round(64 * (input.lyricScale ?? 1)),
    maxLines: 3,
    ratio: 1.3,
  })
  const blockHeight = window.lines.length * window.lineHeight
  const top = LYRIC_BLOCK_CENTER - blockHeight / 2
  ctx.fillStyle = LYRIC_COLORS.ink
  ctx.font = font(600, window.size)
  window.lines.forEach((line, i) => ctx.fillText(line, LYRIC_PAD, top + i * window.lineHeight))

  paintMark(ctx, input.provider, LYRIC_PAD, LYRIC_MARK_TOP, LYRIC_COLORS)
}

const STYLE_DRAWERS: Record<MusicCardStyle, (ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, input: MusicCardInput) => void> = {
  cover: drawCover,
  lyrics: drawLyrics,
}

function resolveStyle(style: MusicCardStyle | undefined): MusicCardStyle {
  return style && MUSIC_CARD_STYLE_IDS.includes(style) ? style : DEFAULT_MUSIC_CARD_STYLE
}

/** Paint the card. Fonts must be ready; the caller awaits `document.fonts`. */
export function drawMusicCard(
  ctx: CanvasRenderingContext2D,
  artwork: CanvasImageSource,
  input: MusicCardInput,
): void {
  STYLE_DRAWERS[resolveStyle(input.style)](ctx, artwork, input)
}

export function loadMusicArtwork(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Artwork could not be loaded'))
    img.src = url
  })
}

/** Render one card to a PNG blob. `document.fonts.ready` runs first. */
export async function renderMusicCardBlob(
  artwork: CanvasImageSource,
  input: MusicCardInput,
): Promise<Blob> {
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = CARD_SIZE
  canvas.height = CARD_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('A 2D canvas is not available')
  drawMusicCard(ctx, artwork, input)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob)
        resolve(blob)
      else
        reject(new Error('PNG encoding failed'))
    }, 'image/png')
  })
}
