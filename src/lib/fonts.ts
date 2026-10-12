export interface FontMeta {
  id: string
  label: string
  cssStack: string
  gfFamily: string | null
  cat: 'system' | 'sans' | 'serif' | 'display' | 'hand' | 'mono'
}

export const SYSTEM_FONT: FontMeta = {
  id: '',
  label: 'System',
  cssStack: '-apple-system, BlinkMacSystemFont, \'Segoe UI\', \'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', \'Noto Sans SC\', sans-serif',
  gfFamily: null,
  cat: 'system',
}

function makeFonts(
  cat: FontMeta['cat'],
  fallback: string,
  families: string[],
): FontMeta[] {
  return families.map(family => ({
    id: family.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: family,
    cssStack: `"${family}", ${fallback}`,
    gfFamily: family,
    cat,
  }))
}

export const FONT_CATALOG: FontMeta[] = [
  ...makeFonts('sans', 'system-ui, sans-serif', [
    'Inter',
    'Roboto',
    'Open Sans',
    'Lato',
    'Montserrat',
    'Poppins',
    'Nunito',
    'Raleway',
    'Work Sans',
    'DM Sans',
    'Manrope',
    'Rubik',
    'Karla',
    'Mulish',
    'Barlow',
    'Outfit',
    'Space Grotesk',
    'Sora',
    'Plus Jakarta Sans',
    'Figtree',
  ]),
  ...makeFonts('serif', 'Georgia, serif', [
    'Merriweather',
    'Playfair Display',
    'Lora',
    'PT Serif',
    'Source Serif 4',
    'Libre Baskerville',
    'EB Garamond',
    'Bitter',
    'Domine',
  ]),
  ...makeFonts('display', 'Impact, sans-serif', [
    'Bebas Neue',
    'Anton',
    'Oswald',
    'Archivo Black',
    'Abril Fatface',
    'Alfa Slab One',
    'Righteous',
  ]),
  ...makeFonts('hand', 'cursive', [
    'Caveat',
    'Patrick Hand',
    'Dancing Script',
    'Shadows Into Light',
    'Sacramento',
    'Indie Flower',
    'Permanent Marker',
    'Kalam',
  ]),
  ...makeFonts('mono', 'monospace', [
    'JetBrains Mono',
    'Fira Mono',
    'Space Mono',
    'IBM Plex Mono',
  ]),
]

const CATALOG_BY_ID = new Map(FONT_CATALOG.map(font => [font.id, font]))

export function fontById(id: string): FontMeta {
  return CATALOG_BY_ID.get(id) ?? SYSTEM_FONT
}

const GOOGLE_HOST = 'fonts.googleapis.com'
const MIRROR_HOST = 'fonts.loli.net'
const LOAD_TIMEOUT_MS = 3000

function delay(ms: number): Promise<FontFace[]> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms, [])
  })
}

const loadAttempts = new Map<string, Promise<boolean>>()

function loadFamily(family: string, host: string, cssStack: string): Promise<boolean> {
  const key = `${host}\n${family}`
  const cached = loadAttempts.get(key)
  if (cached)
    return cached
  const attempt = (async (): Promise<boolean> => {
    if (typeof document === 'undefined' || !document.head)
      return false
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://${host}/css2?family=${encodeURIComponent(family)}&display=swap`
    document.head.appendChild(link)
    try {
      const faces = await Promise.race([
        document.fonts.load(`400 16px ${cssStack}`),
        delay(LOAD_TIMEOUT_MS),
      ])
      return faces.length > 0
    }
    catch {
      return false
    }
  })()
  loadAttempts.set(key, attempt)
  return attempt
}

const MIRROR_KEY = 'collage:fontMirror'

export function mirrorEnabled(): boolean {
  try {
    // Default to on: it only kicks in when googleapis is unreachable anyway.
    const v = localStorage.getItem(MIRROR_KEY)
    return v == null ? true : v === '1'
  }
  catch {
    return true
  }
}

export function setMirrorEnabled(v: boolean): void {
  try {
    localStorage.setItem(MIRROR_KEY, v ? '1' : '0')
  }
  catch {
  }
}

async function loadFont(font: FontMeta): Promise<boolean> {
  const family = font.gfFamily
  if (!family)
    return true
  if (await loadFamily(family, GOOGLE_HOST, font.cssStack))
    return true
  if (mirrorEnabled() && await loadFamily(family, MIRROR_HOST, font.cssStack))
    return true
  return false
}

export async function ensureFonts(ids: string[]): Promise<string[]> {
  const wanted = new Map<string, FontMeta>()
  for (const id of ids) {
    if (wanted.has(id))
      continue
    const font = fontById(id)
    if (font.gfFamily)
      wanted.set(id, font)
  }
  const results = await Promise.all(
    [...wanted].map(async ([id, font]) => ({ id, ok: await loadFont(font) })),
  )
  return results.filter(r => !r.ok).map(r => r.id)
}

const lineHeightCache = new Map<string, number>()

// Ratio of the browser's `line-height: normal` line box to font-size for this
// family AND text, measured with a hidden span so the exporter can reproduce
// the DOM preview's label box exactly. The text matters: CJK or other fallback
// glyphs pull in taller fonts that grow the line box beyond the primary font.
// Call after ensureFonts() so the real web font is active. 0 = unavailable.
export function normalLineHeightRatio(font: FontMeta, text: string): number {
  const key = `${font.id}\n${text}`
  const cached = lineHeightCache.get(key)
  if (cached !== undefined)
    return cached
  let ratio = 0
  try {
    const span = document.createElement('span')
    span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;display:inline-block;line-height:normal;font:400 100px ${font.cssStack}`
    span.textContent = text || 'Hxjgq'
    document.body.appendChild(span)
    ratio = span.getBoundingClientRect().height / 100
    span.remove()
  }
  catch {
    ratio = 0
  }
  lineHeightCache.set(key, ratio)
  return ratio
}

let measureCtx: CanvasRenderingContext2D | null = null

export function measureLabel(
  font: FontMeta,
  px: number,
  text: string,
): { w: number, ascent: number, descent: number, fontAscent: number, fontDescent: number } {
  // fontAscent/fontDescent (fontBoundingBox*) match the DOM `line-height: normal`
  // line box; the exporter sizes the white box from those so preview and export agree.
  const empty = { w: 0, ascent: 0, descent: 0, fontAscent: 0, fontDescent: 0 }
  const t = text.trim()
  if (!t)
    return empty
  try {
    if (!measureCtx) {
      const canvas = document.createElement('canvas')
      measureCtx = canvas.getContext('2d')
    }
    if (!measureCtx)
      return empty
    measureCtx.font = `400 ${px}px ${font.cssStack}`
    const m = measureCtx.measureText(t)
    return {
      w: Math.max(0, m.width),
      ascent: Math.max(0, m.actualBoundingBoxAscent ?? 0),
      descent: Math.max(0, m.actualBoundingBoxDescent ?? 0),
      fontAscent: Math.max(0, m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 0),
      fontDescent: Math.max(0, m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 0),
    }
  }
  catch {
    return empty
  }
}
