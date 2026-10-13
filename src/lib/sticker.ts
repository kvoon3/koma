// Die-cut sticker rasterizer, adapted from CatsJuice/sticker-forge (MIT)

export type StickerSource
  = | { type: 'text', text: string, color?: string, fontFamily?: string, fontWeight?: number | string }
    | { type: 'image', src: string, name?: string }

export type StickerMaterialType = 'original' | 'holographic' | 'glitter'

export interface StickerMakeOptions {
  outlineWidth?: number
  outlineColor?: string
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
const TEXTURE_PADDING = 144
const VISIBLE_ALPHA_THRESHOLD = 0.1 * 255

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

const DISTANCE_INFINITY = 1_000_000_000_000

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

async function renderTextSource(source: StickerTextSource) {
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
  const padding = TEXTURE_PADDING
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

async function renderImageSource(source: StickerImageSource) {
  const image = await loadImage(source.src)
  const hasTransparency = imageHasTransparency(image)
  const aspect = clamp(image.naturalWidth / image.naturalHeight, 0.15, 8)
  const padding = TEXTURE_PADDING
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

function tintAlpha(source: HTMLCanvasElement, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'destination-in'
  context.drawImage(source, 0, 0)
  return canvas
}

function distanceTransform1D(
  source: Float32Array,
  sourceOffset: number,
  sourceStride: number,
  target: Float32Array,
  targetOffset: number,
  targetStride: number,
  length: number,
  parabolas: Int32Array,
  boundaries: Float64Array,
) {
  let envelopeIndex = 0
  parabolas[0] = 0
  boundaries[0] = Number.NEGATIVE_INFINITY
  boundaries[1] = Number.POSITIVE_INFINITY

  for (let position = 1; position < length; position += 1) {
    let previous = parabolas[envelopeIndex]
    let intersection
      = (source[sourceOffset + position * sourceStride] + position * position
        - (source[sourceOffset + previous * sourceStride] + previous * previous))
      / (2 * position - 2 * previous)
    while (intersection <= boundaries[envelopeIndex]) {
      envelopeIndex -= 1
      previous = parabolas[envelopeIndex]
      intersection
        = (source[sourceOffset + position * sourceStride] + position * position
          - (source[sourceOffset + previous * sourceStride] + previous * previous))
        / (2 * position - 2 * previous)
    }
    envelopeIndex += 1
    parabolas[envelopeIndex] = position
    boundaries[envelopeIndex] = intersection
    boundaries[envelopeIndex + 1] = Number.POSITIVE_INFINITY
  }

  envelopeIndex = 0
  for (let position = 0; position < length; position += 1) {
    while (boundaries[envelopeIndex + 1] < position)
      envelopeIndex += 1
    const nearest = parabolas[envelopeIndex]
    const delta = position - nearest
    target[targetOffset + position * targetStride]
      = delta * delta + source[sourceOffset + nearest * sourceStride]
  }
}

/** Expands an alpha silhouette with a continuous round Euclidean offset. */
function expandAlpha(source: HTMLCanvasElement, radius: number) {
  const width = source.width
  const height = source.height
  const sourceContext = source.getContext('2d', { willReadFrequently: true })
  if (!sourceContext)
    throw new Error('Canvas 2D is unavailable.')
  const sourcePixels = sourceContext.getImageData(0, 0, width, height).data
  const size = width * height
  const seeds = new Float32Array(size)
  const rowDistances = new Float32Array(size)
  let hasSeed = false

  for (let pixel = 0; pixel < size; pixel += 1) {
    const occupied = sourcePixels[pixel * 4 + 3] >= VISIBLE_ALPHA_THRESHOLD
    seeds[pixel] = occupied ? 0 : DISTANCE_INFINITY
    hasSeed ||= occupied
  }

  const maxLength = Math.max(width, height)
  const parabolas = new Int32Array(maxLength)
  const boundaries = new Float64Array(maxLength + 1)
  if (hasSeed) {
    for (let y = 0; y < height; y += 1) {
      distanceTransform1D(seeds, y * width, 1, rowDistances, y * width, 1, width, parabolas, boundaries)
    }
    for (let x = 0; x < width; x += 1) {
      distanceTransform1D(rowDistances, x, width, seeds, x, width, height, parabolas, boundaries)
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  const mask = context.createImageData(width, height)
  for (let pixel = 0; pixel < size; pixel += 1) {
    const coverage = hasSeed
      ? clamp(radius + 0.5 - Math.sqrt(seeds[pixel]), 0, 1)
      : 0
    const offset = pixel * 4
    mask.data[offset] = 255
    mask.data[offset + 1] = 255
    mask.data[offset + 2] = 255
    mask.data[offset + 3] = Math.round(coverage * 255)
  }
  context.putImageData(mask, 0, 0)
  return canvas
}

function addOutline(source: HTMLCanvasElement, outline: { width: number, color: string }) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('Canvas 2D is unavailable.')

  const radius = clamp(outline.width * 2.35, 0, 112)
  if (radius > 0.25) {
    const expandedAlpha = expandAlpha(source, radius)
    context.drawImage(tintAlpha(expandedAlpha, outline.color), 0, 0)
  }
  context.drawImage(source, 0, 0)
  return canvas
}

async function prepareArtwork(
  source: StickerSource,
  outline: { width: number, color: string },
): Promise<PreparedArtwork> {
  const rendered = source.type === 'image'
    ? await renderImageSource(source)
    : { canvas: await renderTextSource(source), hasTransparency: true }
  const canvas = addOutline(rendered.canvas, outline)
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
    const lightAngle = Math.atan2(lightY, lightX)
    const lightStrength = Math.min(1.4, Math.max(0.45, 0.5 + intensity * 0.625))
    const count = Math.min(8000, Math.round(((width * height) / 520) * scale * scale))
    const randomValues = getGlitterRandomValues(resolved.seed, count)
    for (let index = 0; index < count; index += 1) {
      const randomOffset = index * GLITTER_RANDOM_VALUES_PER_FLAKE
      const x = randomValues[randomOffset] * width
      const y = randomValues[randomOffset + 1] * height
      const bright = randomValues[randomOffset + 2] > 0.5
      const opacity = randomValues[randomOffset + 3]
      const orientation = ((x * 0.013 + y * 0.017 + resolved.seed * 7) % 1) * Math.PI * 2
      const twinkle
        = 0.18
          + Math.max(0, Math.cos(orientation - lightAngle)) ** 10 * 0.82
      context.globalAlpha = 0.38 * amount * opacity * twinkle * lightStrength
      context.fillStyle = bright ? '#ffffff' : '#34281f'
      const size = (0.7 + randomValues[randomOffset + 4] * 1.8) / Math.sqrt(scale)
      context.fillRect(x, y, size, size)
    }
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
