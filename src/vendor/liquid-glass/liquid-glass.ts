/**
 * Vendored from https://github.com/shuding/liquid-glass
 * Upstream file: liquid-glass.js @ a2d2e847f793430e3409a52927af815a23f4d372
 * Copyright (c) 2025 Shu Ding. MIT License (see ./LICENSE).
 *
 * Adapted for koma (see ./README.md): the console-paste IIFE's DOM, drag and
 * mouse code is removed; the SDF helpers, default fragment, displacement-map
 * generation and the glass CSS recipe are kept as typed exports.
 */

export interface Vec2 { x: number, y: number }
export type Fragment = (uv: Vec2) => Vec2

export function smoothStep(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

export function roundedRectSDF(x: number, y: number, width: number, height: number, radius: number): number {
  const qx = Math.abs(x) - width + radius
  const qy = Math.abs(y) - height + radius
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

function texture(x: number, y: number): Vec2 {
  return { x, y }
}

/** Upstream's default fragment (createLiquidGlass), unchanged. */
export const liquidGlassFragment: Fragment = (uv) => {
  const ix = uv.x - 0.5
  const iy = uv.y - 0.5
  const distanceToEdge = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6)
  const displacement = smoothStep(0.8, 0, distanceToEdge - 0.15)
  const scaled = smoothStep(0, 1, displacement)
  return texture(ix * scaled + 0.5, iy * scaled + 0.5)
}

/**
 * Upstream `Shader.updateShader` without the canvas: RGBA displacement map
 * (R = dx, G = dy, centered on 0.5) and the feDisplacementMap scale.
 */
export function displacementMap(w: number, h: number, fragment: Fragment = liquidGlassFragment): { data: Uint8ClampedArray, scale: number } {
  const data = new Uint8ClampedArray(w * h * 4)
  let maxScale = 0
  const rawValues: number[] = []

  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % w
    const y = Math.floor(i / 4 / w)
    const pos = fragment({ x: x / w, y: y / h })
    const dx = pos.x * w - x
    const dy = pos.y * h - y
    maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
    rawValues.push(dx, dy)
  }

  maxScale *= 0.5
  // koma: guard the degenerate all-zero map (upstream divides by 0 → NaN).
  const div = maxScale || 1

  let index = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = rawValues[index++]! / div + 0.5
    const g = rawValues[index++]! / div + 0.5
    data[i] = r * 255
    data[i + 1] = g * 255
    data[i + 2] = 0
    data[i + 3] = 255
  }
  return { data, scale: maxScale }
}

/** Upstream map → PNG data URL via a detached canvas (browser only). */
export function displacementMapURL(w: number, h: number, fragment?: Fragment): { href: string, scale: number } {
  const { data, scale } = displacementMap(w, h, fragment)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  return { href: canvas.toDataURL(), scale }
}

/** Upstream container `backdrop-filter`, with the filter id parameterized. */
export const glassBackdrop = (filterId: string) => `url(#${filterId}) blur(0.25px) contrast(1.2) brightness(1.05) saturate(1.1)`
/** Upstream container `box-shadow`. */
export const GLASS_SHADOW = '0 4px 8px rgba(0, 0, 0, 0.25), 0 -10px 25px inset rgba(0, 0, 0, 0.15)'
