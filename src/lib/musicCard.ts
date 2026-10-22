/**
 * The music card: a 1024 square, opaque PNG made from a track's artwork and
 * the two lines a listener reads (title, artist) plus a small provider mark.
 *
 * Text fitting is a pure function with the measurer injected, so the layout
 * rules (two lines, shrink to 40 before ellipsis) are tested under Bun without
 * a canvas. The renderer is the browser half: it only paints what the fit
 * decided.
 */
import type { MusicProvider } from './musicLink'

export const CARD_SIZE = 1024

/** The card's palette: warm paper, near-black ink, a quiet grey, a hairline. */
export const CARD_COLORS = {
  ground: '#F3EFE7',
  ink: '#171717',
  muted: '#6B6B6B',
  hairline: '#D8D2C6',
} as const

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

export interface TitleFit {
  lines: string[]
  /** The size the lines are drawn at, `TITLE_MAX_SIZE` when they fit at once. */
  size: number
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
 * Fit a title into at most two lines, 640 wide, shrinking from 54 down to 40
 * before anything is ellipsized. The largest size that keeps it within two
 * lines wins; at 40 the second line gets the ellipsis.
 */
export function fitTitle(text: string, measure: Measure): TitleFit {
  const source = normalizeLine(text)
  if (!source)
    return { lines: [], size: TITLE_MAX_SIZE }

  for (let size = TITLE_MAX_SIZE; size >= TITLE_MIN_SIZE; size--) {
    const lines = wrapText(source, size, TITLE_MAX_W, measure)
    if (lines.length <= TITLE_MAX_LINES)
      return { lines, size }
  }

  const lines = wrapText(source, TITLE_MIN_SIZE, TITLE_MAX_W, measure)
  const kept = lines.slice(0, TITLE_MAX_LINES)
  // More lines than the card allows: the second one always ends in an ellipsis,
  // even when the visible text itself would have fit the box.
  kept[kept.length - 1] = forcedEllipsis(kept[kept.length - 1]!, TITLE_MIN_SIZE, TITLE_MAX_W, measure)
  return { lines: kept, size: TITLE_MIN_SIZE }
}

/** The artist rides one line at 30px; too long is an ellipsis, never a wrap. */
export function fitArtist(text: string, measure: Measure): string {
  const source = normalizeLine(text)
  return source ? ellipsizeToWidth(source, ARTIST_SIZE, TITLE_MAX_W, measure) : ''
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
}

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${CARD_FONT}`
}

/** Paint the card. Fonts must be ready; the caller awaits `document.fonts`. */
export function drawMusicCard(
  ctx: CanvasRenderingContext2D,
  artwork: CanvasImageSource,
  input: MusicCardInput,
): void {
  const measureAt = (weight: number): Measure => (text, size) => {
    ctx.font = font(weight, size)
    return ctx.measureText(text).width
  }
  const title = fitTitle(input.title, measureAt(600))
  const artist = fitArtist(input.artist, measureAt(500))

  ctx.fillStyle = CARD_COLORS.ground
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)

  // No crop and no text over the art: the square sits in its own box, with a
  // hairline that keeps a pale cover from melting into the paper.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(artwork, ART_RECT.x, ART_RECT.y, ART_RECT.size, ART_RECT.size)
  ctx.strokeStyle = CARD_COLORS.hairline
  ctx.lineWidth = 1
  ctx.strokeRect(ART_RECT.x + 0.5, ART_RECT.y + 0.5, ART_RECT.size - 1, ART_RECT.size - 1)

  // A two-line title spends the space the artist's descenders need, so the
  // whole text block lifts to keep the provider mark clear of the artist.
  const titleTop = TITLE_TOP - (title.lines.length > 1 ? TWO_LINE_TITLE_LIFT : 0)

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = CARD_COLORS.ink
  ctx.font = font(600, title.size)
  title.lines.forEach((line, i) => ctx.fillText(line, TEXT_X, titleTop + i * TITLE_LINE_H))

  const afterTitle = titleTop + title.lines.length * TITLE_LINE_H
  if (artist) {
    ctx.fillStyle = CARD_COLORS.muted
    ctx.font = font(500, ARTIST_SIZE)
    ctx.fillText(artist, TEXT_X, afterTitle + (title.lines.length ? 6 : 0))
  }

  // Provider mark: a colored dot, then a quiet uppercase label.
  const dotX = TEXT_X + 5
  const dotY = MARK_TOP + 5
  ctx.fillStyle = PROVIDER_COLORS[input.provider]
  ctx.beginPath()
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = CARD_COLORS.muted
  ctx.font = font(600, 20)
  ctx.textBaseline = 'middle'
  ctx.fillText(PROVIDER_LABELS[input.provider].toUpperCase(), TEXT_X + 18, dotY)
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
