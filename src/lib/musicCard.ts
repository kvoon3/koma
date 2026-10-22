/**
 * The music card: an opaque PNG made from a track's artwork and the lines a
 * listener reads (title, artist) plus a small provider mark.
 *
 * Text fitting is a pure function with the measurer injected, so the layout
 * rules (line count, shrink, ellipsis) are tested under Bun without a canvas.
 * The renderer is the browser half: it only paints what the fit decided.
 *
 * The five paper styles are square and keep the artwork uncropped; they differ
 * in where the square sits, how much paper surrounds it, and how loudly the
 * title speaks. Poster is 4:5 and puts the artwork behind the words: a track
 * card, the song's first lines, or a music-video still.
 */
import type { MusicProvider } from './musicLink'
import { firstLyricLines } from './lyrics'

export const CARD_SIZE = 1024
/** The poster is 4:5; the square styles keep `CARD_SIZE` on both edges. */
export const POSTER_SIZE = { width: 1024, height: 1280 } as const

export interface CardSize {
  width: number
  height: number
}

/** The canvas a style renders on; callers size the canvas before drawing. */
export function cardSize(style: MusicCardStyle | undefined): CardSize {
  return style === 'poster' ? POSTER_SIZE : { width: CARD_SIZE, height: CARD_SIZE }
}

export interface CardPalette {
  ground: string
  ink: string
  muted: string
  hairline: string
}

/** The default card's palette: warm paper, near-black ink, a quiet grey. */
export const CARD_COLORS: CardPalette = {
  ground: '#F3EFE7',
  ink: '#171717',
  muted: '#6B6B6B',
  hairline: '#D8D2C6',
}

const NOIR_COLORS: CardPalette = {
  ground: '#111111',
  ink: '#F3EFE7',
  muted: '#A8A29A',
  hairline: '#3A3733',
}

const POLAROID_COLORS: CardPalette = {
  ground: '#FFFFFF',
  ink: '#171717',
  muted: '#6B6B6B',
  hairline: '#E3DED4',
}

const VINYL_COLORS: CardPalette = {
  ground: '#E7DFD2',
  ink: '#171717',
  muted: '#6B6B6B',
  hairline: '#C9C0B0',
}

const EDITORIAL_COLORS: CardPalette = {
  ground: '#F7F5F0',
  ink: '#171717',
  muted: '#6B6B6B',
  hairline: '#D8D2C6',
}

const POSTER_COLORS: CardPalette = {
  ground: '#111111',
  ink: '#FFFFFF',
  muted: 'rgba(255, 255, 255, 0.74)',
  hairline: 'rgba(255, 255, 255, 0.24)',
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

export const ART_RECT = { x: 192, y: 88, size: 640 } as const
export const TEXT_X = 192
export const TITLE_TOP = 792
/** How far a two-line title lifts its text block. */
export const TWO_LINE_TITLE_LIFT = 20
export const TITLE_MAX_W = 640
export const TITLE_MAX_SIZE = 54
export const TITLE_MIN_SIZE = 40
export const TITLE_LINE_H = 60
export const TITLE_MAX_LINES = 2
export const ARTIST_SIZE = 30
export const MARK_TOP = 952

/** The six compositions, in the order the dialog's picker shows them. */
export const MUSIC_CARD_STYLE_IDS = ['poster', 'classic', 'noir', 'polaroid', 'vinyl', 'editorial'] as const
export type MusicCardStyle = typeof MUSIC_CARD_STYLE_IDS[number]
export const DEFAULT_MUSIC_CARD_STYLE: MusicCardStyle = 'poster'

/** What the poster puts in front of its cover. The square styles ignore it. */
export type MusicCardMode = 'track' | 'lyrics' | 'video'

export interface TitleFit {
  lines: string[]
  /** The size the lines are drawn at, the maximum when they fit at once. */
  size: number
}

export interface TitleFitOptions {
  /** The width of the text column; defaults to the classic card's 640. */
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
 * style's maximum to its minimum before anything is ellipsized. The largest
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
  /** The words the poster's lyrics mode sets; ignored by the other styles. */
  lyrics?: string
  /** Defaults to `track`; only the poster reads it. */
  mode?: MusicCardMode
  /** Defaults to `poster`; the rendered PNG carries the style itself. */
  style?: MusicCardStyle
}

export interface LyricFit {
  lines: string[]
  size: number
  lineHeight: number
}

export interface LyricFitOptions {
  maxWidth?: number
  maxSize?: number
  minSize?: number
  maxLines?: number
  /** Line height as a multiple of the type size; defaults to 1.35. */
  ratio?: number
}

/**
 * Fit the leading lyric lines as one centered block. Each line is its own line,
 * so the song's phrasing survives; if the longest one cannot fit even at the
 * minimum, every line that overflows gets the ellipsis.
 */
export function fitLyrics(lines: string[], measure: Measure, options: LyricFitOptions = {}): LyricFit {
  const maxWidth = options.maxWidth ?? 820
  const maxSize = options.maxSize ?? 56
  const minSize = options.minSize ?? 30
  const maxLines = Math.max(1, options.maxLines ?? 5)
  const ratio = options.ratio ?? 1.35
  const kept = lines.map(normalizeLine).filter(Boolean).slice(0, maxLines)
  if (!kept.length)
    return { lines: [], size: maxSize, lineHeight: Math.round(maxSize * ratio) }
  for (let size = maxSize; size >= minSize; size--) {
    if (kept.every(line => measure(line, size) <= maxWidth))
      return { lines: kept, size, lineHeight: Math.round(size * ratio) }
  }
  return {
    lines: kept.map(line => ellipsizeToWidth(line, minSize, maxWidth, measure)),
    size: minSize,
    lineHeight: Math.round(minSize * ratio),
  }
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

interface ArtBox {
  x: number
  y: number
  size: number
}

interface TextLayout {
  x: number
  width: number
  top: number
  align: 'left' | 'center'
  maxSize: number
  minSize: number
  maxLines: number
  lineHeight: number | ((size: number) => number)
  titleWeight: number
  artistSize: number
  artistGap: number
  /** How far a two-line title lifts its block; only the fixed-bottom cards need it. */
  liftTwoLine: number
}

interface MarkLayout {
  x: number
  top: number
  align: 'left' | 'center'
}

function paintArt(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, box: ArtBox, hairline?: string): void {
  // No crop: the square sits in its own box, with a hairline that keeps a pale
  // cover from melting into the paper.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(artwork, box.x, box.y, box.size, box.size)
  if (!hairline)
    return
  ctx.strokeStyle = hairline
  ctx.lineWidth = 1
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.size - 1, box.size - 1)
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
  return { w: POSTER_SIZE.width, h: POSTER_SIZE.height }
}

/** Fill the whole poster with the cover, cropping only what 4:5 cannot keep. */
function paintCover(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, width: number, height: number): void {
  const { w, h } = sourceSize(artwork)
  if (!w || !h) {
    ctx.drawImage(artwork, 0, 0, width, height)
    return
  }
  const scale = Math.max(width / w, height / h)
  const sw = width / scale
  const sh = height / scale
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(artwork, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, width, height)
}

function paintText(
  ctx: CanvasRenderingContext2D,
  input: MusicCardInput,
  layout: TextLayout,
  palette: CardPalette,
): void {
  const measureAt = (weight: number) => measureFont(ctx, weight)
  const title = fitTitle(input.title, measureAt(layout.titleWeight), {
    maxWidth: layout.width,
    maxSize: layout.maxSize,
    minSize: layout.minSize,
    maxLines: layout.maxLines,
  })
  const artist = fitArtist(input.artist, measureAt(500), layout.width, layout.artistSize)
  const lineHeight = typeof layout.lineHeight === 'function' ? layout.lineHeight(title.size) : layout.lineHeight
  const x = layout.align === 'center' ? layout.x + layout.width / 2 : layout.x
  const titleTop = layout.top - (title.lines.length > 1 ? layout.liftTwoLine : 0)

  ctx.textBaseline = 'top'
  ctx.textAlign = layout.align
  ctx.fillStyle = palette.ink
  ctx.font = font(layout.titleWeight, title.size)
  title.lines.forEach((line, i) => ctx.fillText(line, x, titleTop + i * lineHeight))

  if (!artist)
    return
  // A two-line title spends the space the artist's descenders need in the
  // fixed-bottom cards; the lift above keeps the provider mark clear of them.
  const afterTitle = titleTop + title.lines.length * lineHeight
  ctx.fillStyle = palette.muted
  ctx.font = font(500, layout.artistSize)
  ctx.fillText(artist, x, afterTitle + (title.lines.length ? layout.artistGap : 0))
}

function paintMark(
  ctx: CanvasRenderingContext2D,
  provider: MusicProvider,
  layout: MarkLayout,
  palette: CardPalette,
): void {
  const label = PROVIDER_LABELS[provider].toUpperCase()
  ctx.font = font(600, 20)
  const labelWidth = ctx.measureText(label).width
  // The dot is 10 wide, then an 8px gap; the whole mark is centered when the
  // composition centers it, so the stamp shares the caption's axis.
  const total = 10 + 8 + labelWidth
  const start = layout.align === 'center' ? layout.x - total / 2 : layout.x
  const dotY = layout.top + 5

  ctx.fillStyle = PROVIDER_COLORS[provider]
  ctx.beginPath()
  ctx.arc(start + 5, dotY, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = palette.muted
  ctx.font = font(600, 20)
  ctx.fillText(label, start + 18, dotY)
}

const CLASSIC_TEXT: TextLayout = {
  x: TEXT_X,
  width: TITLE_MAX_W,
  top: TITLE_TOP,
  align: 'left',
  maxSize: TITLE_MAX_SIZE,
  minSize: TITLE_MIN_SIZE,
  maxLines: TITLE_MAX_LINES,
  lineHeight: TITLE_LINE_H,
  titleWeight: 600,
  artistSize: ARTIST_SIZE,
  artistGap: 6,
  liftTwoLine: TWO_LINE_TITLE_LIFT,
}

const CLASSIC_MARK: MarkLayout = { x: TEXT_X, top: MARK_TOP, align: 'left' }

function drawClassic(
  ctx: CanvasRenderingContext2D,
  artwork: CanvasImageSource,
  input: MusicCardInput,
  palette: CardPalette,
): void {
  ctx.fillStyle = palette.ground
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)
  paintArt(ctx, artwork, ART_RECT, palette.hairline)
  paintText(ctx, input, CLASSIC_TEXT, palette)
  paintMark(ctx, input.provider, CLASSIC_MARK, palette)
}

const POLAROID_ART: ArtBox = { x: 152, y: 88, size: 720 }
const POLAROID_TEXT: TextLayout = {
  x: 152,
  width: 720,
  top: 844,
  align: 'center',
  maxSize: 46,
  minSize: 36,
  maxLines: 2,
  lineHeight: 52,
  titleWeight: 600,
  artistSize: 26,
  artistGap: 6,
  liftTwoLine: 0,
}
const POLAROID_MARK: MarkLayout = { x: CARD_SIZE / 2, top: 40, align: 'center' }

function drawPolaroid(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, input: MusicCardInput): void {
  ctx.fillStyle = POLAROID_COLORS.ground
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)
  paintArt(ctx, artwork, POLAROID_ART, POLAROID_COLORS.hairline)
  paintText(ctx, input, POLAROID_TEXT, POLAROID_COLORS)
  paintMark(ctx, input.provider, POLAROID_MARK, POLAROID_COLORS)
}

const VINYL_ART: ArtBox = { x: 172, y: 96, size: 560 }
const VINYL_TEXT: TextLayout = {
  x: 172,
  width: 680,
  top: 760,
  align: 'left',
  maxSize: 54,
  minSize: 40,
  maxLines: 2,
  lineHeight: 60,
  titleWeight: 600,
  artistSize: 30,
  artistGap: 6,
  liftTwoLine: 20,
}
const VINYL_MARK: MarkLayout = { x: 172, top: MARK_TOP, align: 'left' }

function drawVinyl(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, input: MusicCardInput): void {
  ctx.fillStyle = VINYL_COLORS.ground
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)

  // A record peeks out from behind the sleeve. Its label and hole stay right of
  // the sleeve's edge, so the visible crescent reads as a disc, not a dark arc.
  const cx = 770
  const cy = 376
  const radius = 250
  ctx.fillStyle = '#151311'
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'
  ctx.lineWidth = 1.5
  for (let r = 100; r <= 240; r += 20) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.fillStyle = '#D9CFBB'
  ctx.beginPath()
  ctx.arc(cx, cy, 72, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#151311'
  ctx.beginPath()
  ctx.arc(cx, cy, 6, 0, Math.PI * 2)
  ctx.fill()

  paintArt(ctx, artwork, VINYL_ART, VINYL_COLORS.hairline)
  paintText(ctx, input, VINYL_TEXT, VINYL_COLORS)
  paintMark(ctx, input.provider, VINYL_MARK, VINYL_COLORS)
}

const EDITORIAL_ART: ArtBox = { x: 72, y: 72, size: 440 }
const EDITORIAL_RULE = { x: 72, y: 552, width: 880 } as const
const EDITORIAL_TEXT: TextLayout = {
  x: 72,
  width: 880,
  top: 584,
  align: 'left',
  maxSize: 84,
  minSize: 44,
  maxLines: 3,
  lineHeight: size => Math.round(size * 1.05),
  titleWeight: 700,
  artistSize: 30,
  artistGap: 10,
  liftTwoLine: 0,
}
const EDITORIAL_MARK: MarkLayout = { x: 72, top: MARK_TOP, align: 'left' }

function drawEditorial(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, input: MusicCardInput): void {
  ctx.fillStyle = EDITORIAL_COLORS.ground
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)
  paintArt(ctx, artwork, EDITORIAL_ART, EDITORIAL_COLORS.hairline)

  ctx.fillStyle = EDITORIAL_COLORS.hairline
  ctx.fillRect(EDITORIAL_RULE.x, EDITORIAL_RULE.y, EDITORIAL_RULE.width, 1)

  paintText(ctx, input, EDITORIAL_TEXT, EDITORIAL_COLORS)
  paintMark(ctx, input.provider, EDITORIAL_MARK, EDITORIAL_COLORS)
}

const POSTER_TEXT_X = 72
const POSTER_TEXT_W = 880
const POSTER_TITLE_BOTTOM = 1126
const POSTER_ARTIST_TOP = 1170
const POSTER_MARK: MarkLayout = { x: POSTER_TEXT_X, top: 72, align: 'left' }

function paintPosterTrack(ctx: CanvasRenderingContext2D, input: MusicCardInput, video: boolean): void {
  const measureAt = (weight: number) => measureFont(ctx, weight)
  const title = fitTitle(input.title, measureAt(700), {
    maxWidth: POSTER_TEXT_W,
    maxSize: 78,
    minSize: 40,
    maxLines: 2,
  })
  const artist = fitArtist(input.artist, measureAt(500), POSTER_TEXT_W, 30)
  const lineHeight = Math.round(title.size * 1.08)
  const titleTop = POSTER_TITLE_BOTTOM - title.lines.length * lineHeight

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  if (video) {
    ctx.font = font(600, 18)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.62)'
    ctx.fillText('MUSIC VIDEO', POSTER_TEXT_X, Math.max(120, titleTop - 38))
  }

  ctx.fillStyle = POSTER_COLORS.ink
  ctx.font = font(700, title.size)
  title.lines.forEach((line, i) => ctx.fillText(line, POSTER_TEXT_X, titleTop + i * lineHeight))

  if (artist) {
    ctx.fillStyle = POSTER_COLORS.muted
    ctx.font = font(500, 30)
    ctx.fillText(artist, POSTER_TEXT_X, POSTER_ARTIST_TOP)
  }
}

function paintPosterLyrics(ctx: CanvasRenderingContext2D, input: MusicCardInput, lyrics: string[]): void {
  const measureAt = (weight: number) => measureFont(ctx, weight)
  const fit = fitLyrics(lyrics, measureAt(600), {
    maxWidth: 820,
    maxSize: 58,
    minSize: 32,
    maxLines: 6,
    ratio: 1.45,
  })
  const blockHeight = fit.lines.length * fit.lineHeight
  const top = Math.max(230, 620 - blockHeight / 2)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = POSTER_COLORS.ink
  ctx.font = font(600, fit.size)
  fit.lines.forEach((line, i) => ctx.fillText(line, POSTER_SIZE.width / 2, top + i * fit.lineHeight))

  ctx.strokeStyle = POSTER_COLORS.hairline
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(POSTER_TEXT_X, 1042.5)
  ctx.lineTo(POSTER_SIZE.width - POSTER_TEXT_X, 1042.5)
  ctx.stroke()

  const title = fitTitle(input.title, measureAt(600), {
    maxWidth: POSTER_TEXT_W,
    maxSize: 42,
    minSize: 28,
    maxLines: 1,
  })
  ctx.textAlign = 'left'
  if (title.lines[0]) {
    ctx.font = font(600, title.size)
    ctx.fillStyle = POSTER_COLORS.ink
    ctx.fillText(title.lines[0], POSTER_TEXT_X, 1072)
  }

  const artist = fitArtist(input.artist, measureAt(500), POSTER_TEXT_W, 24)
  if (artist) {
    ctx.font = font(500, 24)
    ctx.fillStyle = POSTER_COLORS.muted
    ctx.fillText(artist, POSTER_TEXT_X, 1128)
  }
}

function drawPoster(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, input: MusicCardInput): void {
  const { width, height } = POSTER_SIZE
  const mode = input.mode ?? 'track'
  const lyrics = firstLyricLines(input.lyrics ?? '', 6)

  paintCover(ctx, artwork, width, height)
  ctx.fillStyle = 'rgba(9, 9, 11, 0.30)'
  ctx.fillRect(0, 0, width, height)

  const top = ctx.createLinearGradient(0, 0, 0, 220)
  top.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
  top.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, width, 220)

  const vignette = ctx.createRadialGradient(512, 520, 80, 512, 520, 800)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.46)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)

  const fade = ctx.createLinearGradient(0, 560, 0, height)
  fade.addColorStop(0, 'rgba(9, 9, 11, 0)')
  fade.addColorStop(1, 'rgba(9, 9, 11, 0.94)')
  ctx.fillStyle = fade
  ctx.fillRect(0, 560, width, height - 560)

  if (mode === 'lyrics' && lyrics.length) {
    // The words need a quieter backdrop than the title does.
    ctx.fillStyle = 'rgba(9, 9, 11, 0.42)'
    ctx.fillRect(0, 0, width, height)
    paintPosterLyrics(ctx, input, lyrics)
  }
  else {
    paintPosterTrack(ctx, input, mode === 'video')
  }

  paintMark(ctx, input.provider, POSTER_MARK, POSTER_COLORS)
}

const STYLE_DRAWERS: Record<MusicCardStyle, (ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, input: MusicCardInput) => void> = {
  poster: drawPoster,
  classic: (ctx, artwork, input) => drawClassic(ctx, artwork, input, CARD_COLORS),
  noir: (ctx, artwork, input) => drawClassic(ctx, artwork, input, NOIR_COLORS),
  polaroid: drawPolaroid,
  vinyl: drawVinyl,
  editorial: drawEditorial,
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
  const { width, height } = cardSize(resolveStyle(input.style))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
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
