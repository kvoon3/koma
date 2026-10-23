// Die-cut sticker rasterizer, adapted from CatsJuice/sticker-forge (MIT)
// (https://github.com/CatsJuice/sticker-forge), licensed under the MIT License.
//
// Original work:
//   Copyright (c) 2026 CatsJuice
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type { Perforation, PerforationDesign } from './stickerFX'
import type { WrinkleDesign } from './stickerTexture'
import { composeSilhouette, outlineRadius, parseHexColor, perforationToTexture, silhouettePadding } from './stickerFX'
import { applyWrinkle } from './stickerTexture'

export type StickerSource
  = | { type: 'text', text: string, color?: string, fontFamily?: string, fontWeight?: number | string }
    | { type: 'image', src: string, name?: string }

export type StickerMaterialType = 'original' | 'holographic' | 'glitter'

export interface StickerMakeOptions {
  outlineWidth?: number
  outlineColor?: string
  /**
   * Stamp perforation punched along the border's outer edge, in the sliders'
   * own unit (stage pixels: a bite depth and a period). Absent or null is the
   * plain die-cut border. The bake converts it with `displayLongEdge`.
   */
  perforation?: PerforationDesign | null
  /**
   * Wrinkle shading on the cutout's RGB before the die-cut. Absent or null is
   * off; strength 0 is also a no-op.
   */
  texture?: WrinkleDesign | null
  /**
   * Long edge, in CSS pixels, the result will be shown at (the maker's stage
   * measures it). The perforation sliders read in those pixels, so this is
   * what keeps them WYSIWYG: without it a design number is taken as texture
   * pixels, which is only right for a 1:1 bake.
   */
  displayLongEdge?: number
  maxEdge?: number
  material?: {
    type: StickerMaterialType
    intensity?: number
    scale?: number
    seed?: number
    holographicGrain?: number
    holographicColors?: [string, string, string]
  }
  lighting?: {
    intensity?: number
    ambient?: number
  }
}

export interface StickerMakeResult {
  dataUrl: string
  width: number
  height: number
  aspect: number
}

type StickerTextSource = Extract<StickerSource, { type: 'text' }>
type StickerImageSource = Extract<StickerSource, { type: 'image' }>
type StickerMaterialOptions = NonNullable<StickerMakeOptions['material']>
type StickerLightingOptions = NonNullable<StickerMakeOptions['lighting']>
type ResolvedMaterial = Required<StickerMaterialOptions>

const DEFAULT_OUTLINE_WIDTH = 18
const DEFAULT_OUTLINE_COLOR = '#ffffff'
const DEFAULT_TEXT_COLOR = '#000000'
const DEFAULT_MAX_EDGE = 960

const MAX_TEXTURE_EDGE = 2048
const MIN_TEXTURE_EDGE = 320
/** Default texture margin; `texturePadding` grows it for a wide outline. */
const TEXTURE_PADDING = 144
const CROP_MARGIN = 2

const DEFAULT_MATERIAL: ResolvedMaterial = {
  type: 'original',
  intensity: 0.86,
  scale: 1,
  seed: 0.37,
  holographicGrain: 0.72,
  holographicColors: ['#f2a7c5', '#8edfd5', '#9db4ea'],
}

const DEFAULT_LIGHTING = { intensity: 0.8, ambient: 0.35 }
const DEFAULT_LIGHT_DIRECTION = { x: -0.38, y: 0.52, z: 0.76 }

const SEEDED_RANDOM_MODULUS = 2147483647
const SEEDED_RANDOM_MULTIPLIER = 48271
const HOLOGRAPHIC_NOISE_SIZE = 96
const MATERIAL_PREVIEW_CACHE_LIMIT = 6
const GLITTER_RANDOM_VALUES_PER_FLAKE = 5

/**
 * Texture margin around the artwork so the render itself never clips. The
 * outline pass pads its own frame afterwards, so only the border has to fit
 * here (a notch's outward half is punched air either way).
 */
function texturePadding(outlineWidth: number): number {
  return Math.max(TEXTURE_PADDING, silhouettePadding(outlineRadius(outlineWidth)))
}

interface HolographicNoiseCacheEntry {
  pixels: Uint8ClampedArray
  canvas?: HTMLCanvasElement
}

interface GlitterRandomCacheEntry {
  state: number
  values: Float64Array
}

interface PreparedArtwork {
  canvas: HTMLCanvasElement
  width: number
  height: number
  aspect: number
  hasTransparency: boolean
}

const holographicNoiseCache = new Map<number, HolographicNoiseCacheEntry>()
const glitterRandomCache = new Map<number, GlitterRandomCacheEntry>()

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  if (!/^(?:data:|blob:|https?:|\/|\.\.?\/)/i.test(src))
    throw new Error('The image URL must be relative or use data, blob, HTTP, or HTTPS.')
  const image = new Image()
  image.decoding = 'async'
  if (/^https?:/i.test(src))
    image.crossOrigin = 'anonymous'
  image.src = src
  await image.decode()
  if (!image.naturalWidth || !image.naturalHeight)
    throw new Error('The image has no drawable dimensions.')
  return image
}

function imageHasTransparency(image: HTMLImageElement): boolean {
  const maxEdge = 640
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255)
      return true
  }
  return false
}

async function renderTextSource(source: StickerTextSource, padding: number) {
  const fontFamily = source.fontFamily ?? 'Arial Rounded MT Bold, Arial Black, sans-serif'
  const fontWeight = source.fontWeight ?? 900
  let fontSize = 420
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe)
    throw new Error('Canvas 2D is unavailable.')

  if (document.fonts?.load) {
    try {
      // Pass the text: CJK webfonts load as unicode-range slices, and without
      // it only the default Latin subset is fetched before the canvas draw.
      await document.fonts.load(`${fontWeight} ${fontSize}px ${fontFamily}`, source.text)
    }
    catch {
      // Browser font fallback stays close enough for a raster sticker.
    }
  }

  const lines = (source.text || ' ').split('\n')
  probe.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  let lineMetrics = lines.map(line => probe.measureText(line))
  const initialWidth = Math.max(1, ...lineMetrics.map(m => m.width))
  if (initialWidth > 1750) {
    fontSize *= 1750 / initialWidth
    probe.font = `${fontWeight} ${fontSize}px ${fontFamily}`
    lineMetrics = lines.map(line => probe.measureText(line))
  }

  const lineHeight = fontSize * 1.15
  const ascent = Math.max(1, ...lineMetrics.map(m => m.actualBoundingBoxAscent || fontSize * 0.76))
  const descent = Math.max(1, ...lineMetrics.map(m => m.actualBoundingBoxDescent || fontSize * 0.2))
  const width = clamp(Math.ceil(Math.max(...lineMetrics.map(m => m.width)) + padding * 2), MIN_TEXTURE_EDGE, MAX_TEXTURE_EDGE)
  const contentHeight = lineHeight * (lines.length - 1) + ascent + descent
  const height = clamp(Math.ceil(contentHeight + padding * 2), MIN_TEXTURE_EDGE, 1280)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('Canvas 2D is unavailable.')

  context.clearRect(0, 0, width, height)
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  context.textBaseline = 'alphabetic'
  context.textAlign = 'center'
  context.fillStyle = source.color ?? DEFAULT_TEXT_COLOR
  const firstBaseline = (height - contentHeight) / 2 + ascent
  lines.forEach((line, i) => {
    context.fillText(line, width / 2, firstBaseline + lineHeight * i)
  })
  return canvas
}

async function renderImageSource(source: StickerImageSource, padding: number) {
  const image = await loadImage(source.src)
  const hasTransparency = imageHasTransparency(image)
  const aspect = clamp(image.naturalWidth / image.naturalHeight, 0.15, 8)
  const contentMax = Math.max(1, MAX_TEXTURE_EDGE - padding * 2)
  const contentWidth = aspect >= 1 ? contentMax : contentMax * aspect
  const contentHeight = aspect >= 1 ? contentMax / aspect : contentMax
  const width = clamp(Math.ceil(contentWidth + padding * 2), MIN_TEXTURE_EDGE, MAX_TEXTURE_EDGE)
  const height = clamp(Math.ceil(contentHeight + padding * 2), MIN_TEXTURE_EDGE, MAX_TEXTURE_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  context.clearRect(0, 0, width, height)
  context.drawImage(image, padding, padding, width - padding * 2, height - padding * 2)
  return { canvas, hasTransparency }
}

/**
 * The silhouette painter: the border band under the artwork, then the stamp
 * notches cut through both. Geometry comes from `lib/stickerFX` (the one
 * implementation of the distance field and the border), so this function is
 * only the canvas half.
 *
 * The border is drawn *under* the source through `source-over`, which is what
 * makes it part of the sticker rather than a halo: inside the band's reach the
 * composite is opaque, so an antialiased artwork edge sits on white instead of
 * fading into the page. The notches then cut with `destination-out`, i.e. the
 * composed alpha is multiplied by `1 − punch`, so a hole opens through the
 * border and, when it is wide enough, through the artwork's edge as well.
 *
 * The canvas grows by `silhouettePadding` on every side and the artwork is
 * drawn back in at that offset, so the widest border (or hole) has room
 * instead of being clipped by the texture's own edge.
 */
function applySilhouette(source: HTMLCanvasElement, outline: {
  radius: number
  color: string
  perforation: Perforation | null
}) {
  const width = source.width
  const height = source.height
  const sourceContext = source.getContext('2d', { willReadFrequently: true })
  if (!sourceContext)
    throw new Error('Canvas 2D is unavailable.')
  const pixels = sourceContext.getImageData(0, 0, width, height).data

  // The field runs on the *padded* frame, not the artwork's box: the border
  // lives outside that box, and a distance field that stops at its edge would
  // have nothing to say about the pixels the border is made of.
  const pad = silhouettePadding(outline.radius, outline.perforation)
  const canvas = document.createElement('canvas')
  canvas.width = width + pad * 2
  canvas.height = height + pad * 2
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  const frameWidth = canvas.width
  const frameHeight = canvas.height
  const size = frameWidth * frameHeight
  const alpha = new Float32Array(size)
  for (let y = 0; y < height; y += 1) {
    const from = y * width
    const to = (y + pad) * frameWidth + pad
    for (let x = 0; x < width; x += 1)
      alpha[to + x] = pixels[(from + x) * 4 + 3]! / 255
  }

  const result = composeSilhouette(alpha, frameWidth, frameHeight, {
    radius: outline.radius,
    perforation: outline.perforation,
  })

  if (result.radius > 0.25 || result.centers.length) {
    const band = context.createImageData(frameWidth, frameHeight)
    const [red, green, blue] = parseHexColor(outline.color)
    for (let pixel = 0; pixel < size; pixel += 1) {
      const offset = pixel * 4
      band.data[offset] = red
      band.data[offset + 1] = green
      band.data[offset + 2] = blue
      band.data[offset + 3] = Math.round(result.coverage[pixel]! * 255)
    }
    context.putImageData(band, 0, 0)
  }

  context.drawImage(source, pad, pad)

  if (result.centers.length) {
    const notch = context.createImageData(frameWidth, frameHeight)
    for (let pixel = 0; pixel < size; pixel += 1)
      notch.data[pixel * 4 + 3] = Math.round(result.punch[pixel]! * 255)
    context.globalCompositeOperation = 'destination-out'
    context.drawImage(imageDataCanvas(notch), 0, 0)
    context.globalCompositeOperation = 'source-over'
  }
  return canvas
}

/** An ImageData as a drawable: the punch is painted through a canvas. */
function imageDataCanvas(data: ImageData) {
  const canvas = document.createElement('canvas')
  canvas.width = data.width
  canvas.height = data.height
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  context.putImageData(data, 0, 0)
  return canvas
}

function visibleBounds(pixels: Uint8ClampedArray, width: number, height: number) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4
    for (let x = 0; x < width; x += 1) {
      if (pixels[row + x * 4 + 3] === 0)
        continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < minX ? null : { minX, minY, maxX, maxY }
}

/**
 * Crop the outlined artwork to its visible pixels: the canvas is a padded frame,
 * and a cutout's frame is mostly transparent, so the box a pane places, selects
 * and exports must be the subject's bounds, not the photo's. The hair of margin
 * keeps scaled-down draws off the edge.
 */
function cropToVisible(canvas: HTMLCanvasElement) {
  const { width, height } = canvas
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  const bounds = visibleBounds(context.getImageData(0, 0, width, height).data, width, height)
  // Nothing visible (a fully transparent source): the frame is all there is.
  if (!bounds)
    return canvas
  const left = Math.max(0, bounds.minX - CROP_MARGIN)
  const top = Math.max(0, bounds.minY - CROP_MARGIN)
  const cropWidth = Math.min(width, bounds.maxX + CROP_MARGIN + 1) - left
  const cropHeight = Math.min(height, bounds.maxY + CROP_MARGIN + 1) - top
  if (cropWidth === width && cropHeight === height)
    return canvas
  const cropped = document.createElement('canvas')
  cropped.width = cropWidth
  cropped.height = cropHeight
  const target = cropped.getContext('2d')
  if (!target)
    throw new Error('Canvas 2D is unavailable.')
  target.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return cropped
}

/**
 * Canvas half of the texture: read the cropped artwork, shade its RGB, write
 * it back. Null and 0-strength return the same canvas without touching pixels,
 * which is what keeps a no-texture bake byte-identical.
 */
function applyWrinkleToCanvas(
  canvas: HTMLCanvasElement,
  texture: WrinkleDesign | null | undefined,
): HTMLCanvasElement {
  const strength = texture?.strength
  if (strength == null || !Number.isFinite(strength) || strength <= 0)
    return canvas
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  applyWrinkle(image.data, canvas.width, canvas.height, texture)
  context.putImageData(image, 0, 0)
  return canvas
}

async function prepareArtwork(
  source: StickerSource,
  bake: {
    width: number
    color: string
    perforation: PerforationDesign | null
    displayLongEdge?: number
    texture?: WrinkleDesign | null
  },
): Promise<PreparedArtwork> {
  const radius = outlineRadius(bake.width)
  const padding = texturePadding(bake.width)
  const rendered = source.type === 'image'
    ? await renderImageSource(source, padding)
    : { canvas: await renderTextSource(source, padding), hasTransparency: true }
  // Crop before outlining: a cutout is mostly transparent frame, so the
  // distance field runs over the subject's box. The outline pass pads the
  // canvas back out for its reach. Texture before it: the border is drawn
  // next, and the silhouette reads alpha, which the texture never writes.
  const artwork = applyWrinkleToCanvas(cropToVisible(rendered.canvas), bake.texture)
  // The stamp's WYSIWYG scale: the silhouette's long edge on the texture over
  // the long edge the stage shows it at. A dilation by r grows the box by
  // exactly r per side, so artwork + 2r is the visible long edge.
  const visibleLongEdge = Math.max(artwork.width, artwork.height) + radius * 2
  const displayLongEdge = bake.displayLongEdge ?? 0
  const perforation = bake.perforation
    ? perforationToTexture(
        bake.perforation,
        displayLongEdge > 0 ? visibleLongEdge / displayLongEdge : 1,
      )
    : null
  const canvas = cropToVisible(applySilhouette(artwork, {
    radius,
    color: bake.color,
    perforation,
  }))
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    aspect: canvas.width / canvas.height,
    hasTransparency: rendered.hasTransparency,
  }
}

function seededRandomInitialState(seed: number) {
  return Math.floor(seed * SEEDED_RANDOM_MODULUS) || 1
}

function readSeededLru<Value>(
  cache: Map<number, Value>,
  key: number,
  create: () => Value,
) {
  const existing = cache.get(key)
  if (existing !== undefined) {
    cache.delete(key)
    cache.set(key, existing)
    return existing
  }

  const value = create()
  cache.set(key, value)
  if (cache.size > MATERIAL_PREVIEW_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined)
      cache.delete(oldest)
  }
  return value
}

function getHolographicNoise(seed: number) {
  const initialState = seededRandomInitialState(seed)
  return readSeededLru(holographicNoiseCache, initialState, () => {
    let state = initialState
    const pixels = new Uint8ClampedArray(HOLOGRAPHIC_NOISE_SIZE * HOLOGRAPHIC_NOISE_SIZE * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      state = (state * SEEDED_RANDOM_MULTIPLIER) % SEEDED_RANDOM_MODULUS
      const value = state / SEEDED_RANDOM_MODULUS
      const brightness = value > 0.48 ? 255 : 20
      pixels[index] = brightness
      pixels[index + 1] = brightness
      pixels[index + 2] = brightness
      state = (state * SEEDED_RANDOM_MULTIPLIER) % SEEDED_RANDOM_MODULUS
      pixels[index + 3] = Math.round(38 + (state / SEEDED_RANDOM_MODULUS) * 74)
    }
    return { pixels }
  })
}

function getHolographicNoiseCanvas(seed: number) {
  const entry = getHolographicNoise(seed)
  if (entry.canvas)
    return entry.canvas

  const canvas = document.createElement('canvas')
  canvas.width = HOLOGRAPHIC_NOISE_SIZE
  canvas.height = HOLOGRAPHIC_NOISE_SIZE
  const context = canvas.getContext('2d', { alpha: true })
  if (!context)
    return null
  const noise = context.createImageData(HOLOGRAPHIC_NOISE_SIZE, HOLOGRAPHIC_NOISE_SIZE)
  noise.data.set(entry.pixels)
  context.putImageData(noise, 0, 0)
  entry.canvas = canvas
  return canvas
}

function getGlitterRandomValues(seed: number, count: number) {
  const initialState = seededRandomInitialState(seed)
  const entry = readSeededLru(glitterRandomCache, initialState, () => ({
    state: initialState,
    values: new Float64Array(0),
  }))
  const requiredLength = count * GLITTER_RANDOM_VALUES_PER_FLAKE
  if (entry.values.length >= requiredLength)
    return entry.values

  const values = new Float64Array(requiredLength)
  values.set(entry.values)
  let state = entry.state
  for (let index = entry.values.length; index < requiredLength; index += 1) {
    state = (state * SEEDED_RANDOM_MULTIPLIER) % SEEDED_RANDOM_MODULUS
    values[index] = state / SEEDED_RANDOM_MODULUS
  }
  entry.state = state
  entry.values = values
  return values
}

function scaledPhase(position: number, scale: number) {
  return (position - 0.5) * scale + 0.5
}

function addHolographicStops(
  gradient: CanvasGradient,
  scale: number,
  colors: readonly string[],
  phaseOffset: number,
) {
  const phaseStart = scaledPhase(0, scale) + phaseOffset
  const phaseEnd = scaledPhase(1, scale) + phaseOffset
  const firstStop = Math.floor(phaseStart * 3)
  const lastStop = Math.ceil(phaseEnd * 3)

  // Anchor the ends so scales under 1 still cover the whole sticker.
  gradient.addColorStop(0, colors[((firstStop % 3) + 3) % 3])
  for (let stop = firstStop; stop <= lastStop; stop += 1) {
    const position = (stop / 3 - phaseStart) / scale
    if (position <= 0 || position >= 1)
      continue
    gradient.addColorStop(position, colors[((stop % 3) + 3) % 3])
  }
  gradient.addColorStop(1, colors[((lastStop % 3) + 3) % 3])
}

function applyHolographicFrost(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount: number,
  grain: number,
  scale: number,
  seed: number,
) {
  const noiseCanvas = getHolographicNoiseCanvas(seed)
  if (!noiseCanvas)
    return
  const pattern = context.createPattern(noiseCanvas, 'repeat')
  if (!pattern)
    return
  const noiseScale = 1 / Math.sqrt(scale)
  pattern.setTransform(new DOMMatrix().scaleSelf(noiseScale, noiseScale))
  context.save()
  context.globalAlpha = 0.42 * amount * grain
  context.fillStyle = pattern
  context.fillRect(0, 0, width, height)
  context.restore()
}

function applyGlitterMaterial(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount: number,
  scale: number,
  seed: number,
  lightX: number,
  lightY: number,
  intensity: number,
) {
  const lightAngle = Math.atan2(lightY, lightX)
  const lightStrength = Math.min(1.4, Math.max(0.45, 0.5 + intensity * 0.625))
  // Upstream gallery thumbs use /520; this bake is the final sticker PNG (no
  // live WebGL finish), so density must read on letters and photos alike.
  const count = Math.min(14000, Math.round(((width * height) / 160) * scale * scale))
  const randomValues = getGlitterRandomValues(seed, count)
  const base = context.getImageData(0, 0, width, height)
  const alphaMask = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; i < base.data.length; i += 4, p += 1)
    alphaMask[p] = base.data[i + 3]

  const placeOnDieCut = (randomOffset: number) => {
    let x = randomValues[randomOffset] * width
    let y = randomValues[randomOffset + 1] * height
    // Text silhouettes waste most uniform samples on transparent padding.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const px = Math.min(width - 1, Math.max(0, x | 0))
      const py = Math.min(height - 1, Math.max(0, y | 0))
      if (alphaMask[py * width + px] >= 128)
        return { x, y }
      x = randomValues[(randomOffset + attempt + 1) % randomValues.length] * width
      y = randomValues[(randomOffset + attempt + 2) % randomValues.length] * height
    }
    return { x, y }
  }

  const spectralRgb = (hue: number, mixWhite: number) => {
    const r = 0.55 + 0.45 * Math.cos(Math.PI * 2 * hue)
    const g = 0.55 + 0.45 * Math.cos(Math.PI * 2 * (hue + 1 / 3))
    const b = 0.55 + 0.45 * Math.cos(Math.PI * 2 * (hue + 2 / 3))
    return `rgb(${Math.round((mixWhite + r * (1 - mixWhite)) * 255)},${Math.round((mixWhite + g * (1 - mixWhite)) * 255)},${Math.round((mixWhite + b * (1 - mixWhite)) * 255)})`
  }

  // Spectral + dark facets (source-atop): readable on white outline and mid tones.
  for (let index = 0; index < count; index += 1) {
    const randomOffset = index * GLITTER_RANDOM_VALUES_PER_FLAKE
    const roll = randomValues[randomOffset + 2]
    if (roll < 0.42)
      continue
    const { x, y } = placeOnDieCut(randomOffset)
    const opacity = 0.45 + randomValues[randomOffset + 3] * 0.55
    const orientation = ((x * 0.013 + y * 0.017 + seed * 7) % 1) * Math.PI * 2
    const twinkle = 0.22 + Math.max(0, Math.cos(orientation - lightAngle)) ** 8 * 0.78
    context.fillStyle = roll < 0.72
      ? spectralRgb((roll - 0.42) / 0.3, 0.28)
      : '#2a2118'
    context.globalAlpha = Math.min(1, 0.7 * amount * opacity * twinkle * lightStrength)
    const size = (1.25 + randomValues[randomOffset + 4] * 2.9) / Math.sqrt(scale)
    context.fillRect(x, y, size, size)
  }

  // Bright sparkles: additive like upstream WebGL so they pop on dark fills.
  context.save()
  context.globalCompositeOperation = 'lighter'
  for (let index = 0; index < count; index += 1) {
    const randomOffset = index * GLITTER_RANDOM_VALUES_PER_FLAKE
    const roll = randomValues[randomOffset + 2]
    if (roll >= 0.42)
      continue
    const { x, y } = placeOnDieCut(randomOffset)
    const opacity = 0.5 + randomValues[randomOffset + 3] * 0.5
    const orientation = ((x * 0.013 + y * 0.017 + seed * 7) % 1) * Math.PI * 2
    const twinkle = 0.18 + Math.max(0, Math.cos(orientation - lightAngle)) ** 10 * 0.82
    context.fillStyle = spectralRgb(roll / 0.42, 0.55)
    context.globalAlpha = Math.min(1, 0.95 * amount * opacity * twinkle * lightStrength)
    const size = (1.4 + randomValues[randomOffset + 4] * 3.1) / Math.sqrt(scale)
    context.fillRect(x, y, size, size)
  }
  context.restore()
  const baked = context.getImageData(0, 0, width, height)
  for (let i = 0, p = 0; i < baked.data.length; i += 4, p += 1)
    baked.data[i + 3] = alphaMask[p]
  context.putImageData(baked, 0, 0)
}

function applyMaterialPreview(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  material: StickerMaterialOptions | undefined,
  lighting: StickerLightingOptions | undefined,
) {
  const resolved = { ...DEFAULT_MATERIAL, ...material }
  if (resolved.type === 'original' || resolved.intensity <= 0)
    return

  const amount = Math.min(1, Math.max(0, resolved.intensity))
  const scale = Math.min(4, Math.max(0.2, resolved.scale))
  const direction = DEFAULT_LIGHT_DIRECTION
  const lightLength = Math.hypot(direction.x, direction.y, direction.z) || 1
  const lightX = direction.x / lightLength
  const lightY = direction.y / lightLength
  const defaultLightX = direction.x / lightLength
  const defaultLightY = direction.y / lightLength
  const intensity = Math.min(
    1.5,
    Math.max(0, lighting?.intensity ?? DEFAULT_LIGHTING.intensity),
  )
  context.save()
  context.globalCompositeOperation = 'source-atop'

  if (resolved.type === 'holographic') {
    const rainbow = context.createLinearGradient(0, height, width, 0)
    const lightShift
      = (lightX - defaultLightX) * 0.32
        + (lightY - defaultLightY) * -0.26
    addHolographicStops(rainbow, scale, resolved.holographicColors, lightShift)
    context.fillStyle = rainbow
    context.globalAlpha
      = 0.24
        * amount
        * Math.min(1.3, Math.max(0.6, 1 + (intensity - 0.8) * 0.35))
    context.fillRect(0, 0, width, height)
    applyHolographicFrost(
      context,
      width,
      height,
      amount,
      Math.min(1, Math.max(0, resolved.holographicGrain)),
      scale,
      resolved.seed,
    )
  }

  if (resolved.type === 'glitter') {
    applyGlitterMaterial(
      context,
      width,
      height,
      amount,
      scale,
      resolved.seed,
      lightX,
      lightY,
      intensity,
    )
  }
  context.restore()
}

function createMaterialPreviewCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  material: StickerMaterialOptions | undefined,
  lighting: StickerLightingOptions | undefined,
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context)
    throw new Error('Canvas 2D is unavailable.')

  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  applyMaterialPreview(context, width, height, material, lighting)
  return canvas
}

export async function makeSticker(
  source: StickerSource,
  options: StickerMakeOptions = {},
): Promise<StickerMakeResult> {
  if (typeof document === 'undefined')
    throw new Error('Stickers can only be created in a browser document.')

  const artwork = await prepareArtwork(source, {
    width: options.outlineWidth ?? DEFAULT_OUTLINE_WIDTH,
    color: options.outlineColor ?? DEFAULT_OUTLINE_COLOR,
    perforation: options.perforation ?? null,
    displayLongEdge: options.displayLongEdge,
    texture: options.texture ?? null,
  })
  const originalLongEdge = Math.max(artwork.width, artwork.height)
  const previewScale = Math.min(1, (options.maxEdge ?? DEFAULT_MAX_EDGE) / originalLongEdge)
  const width = Math.max(1, Math.round(artwork.width * previewScale))
  const height = Math.max(1, Math.round(artwork.height * previewScale))

  const canvas = createMaterialPreviewCanvas(
    artwork.canvas,
    width,
    height,
    options.material,
    options.lighting,
  )
  const dataUrl = canvas.toDataURL('image/png')
  if (!/^data:image\/png[;,]/i.test(dataUrl))
    throw new Error('The browser returned an unsupported canvas encoding.')

  return { dataUrl, width, height, aspect: artwork.aspect }
}
