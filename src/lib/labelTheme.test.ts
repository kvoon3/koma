/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { labelLineLayout } from './exporter'
import { DEFAULT_LABEL_THEME, LABEL_GLOW_LAYERS, LABEL_THEME_IDS, LABEL_THEMES, labelColors, labelGlowLayers, labelPaint, labelTextShadow, newLabel, normalizeLabelGlow } from './panes'

describe('label theme registry', () => {
  it('offers the two box themes only, default first', () => {
    expect([...LABEL_THEME_IDS].sort() as string[]).toEqual(Object.keys(LABEL_THEMES).sort())
    expect([...LABEL_THEME_IDS]).toEqual(['dark', 'light'])
    expect<string>(LABEL_THEME_IDS[0]).toBe(DEFAULT_LABEL_THEME)
  })

  it('falls back to the default for a missing or unknown theme (old sessions)', () => {
    expect(labelColors(undefined)).toBe(LABEL_THEMES.dark)
    expect(labelColors('neon' as never)).toBe(LABEL_THEMES.dark)
  })
})

describe('glow as an independent effect', () => {
  it('forces white text and no box, whatever the theme and custom colors', () => {
    for (const theme of ['dark', 'light'] as const) {
      const paint = labelPaint({ theme, glow: true, fg: '#ff0000', bg: '#0000ff', bgAlpha: 0.4 })
      expect(paint.fg).toBe('#ffffff')
      expect(paint.fill).toBe('transparent')
    }
  })

  it('restores the theme pair and custom colors when glow is off', () => {
    expect(labelPaint({ theme: 'light' }).fg).toBe('#000000')
    expect(labelPaint({ theme: 'light' }).fill).toBe('#ffffff')
    expect(labelPaint({ theme: 'dark', glow: false, fg: '#ff0000' }).fg).toBe('#ff0000')
  })

  it('has a halo only while glowing', () => {
    expect(labelGlowLayers({ glow: true })).toBe(LABEL_GLOW_LAYERS)
    expect(labelGlowLayers({})).toBeUndefined()
    expect(labelGlowLayers({ glow: false })).toBeUndefined()
    expect(labelTextShadow({})).toBeUndefined()
  })

  it('spells the halo as one em-relative CSS stack', () => {
    const shadow = labelTextShadow({ glow: true })!
    const parts = shadow.match(/0 0 [^)]+\)/g)!
    expect(parts).toHaveLength(LABEL_GLOW_LAYERS.length)
    // CSS paints back to front: the tight blue rim is listed first, the dark
    // separation rim last (under everything, so it reads on a light photo).
    expect(parts[0]).toContain('0.05em')
    expect(parts[0]).toContain('rgba(40, 120, 255, 1)')
    expect(parts[3]).toContain('0.5em')
    expect(parts[3]).toContain('rgba(70, 140, 255, 0.85)')
    expect(parts[4]).toContain('0.55em')
    expect(parts[4]).toContain('rgba(18, 28, 58, 0.6)')
    for (const part of parts)
      expect(part.startsWith('0 0 ')).toBe(true)
  })
})

describe('legacy sessions (glow was a third theme)', () => {
  const legacy = { ...newLabel(), theme: 'glow' }

  it('hydrates a saved glow theme as the dark theme plus the glow effect', () => {
    const lab = normalizeLabelGlow(legacy)
    expect(lab.theme).toBe(DEFAULT_LABEL_THEME)
    expect(lab.glow).toBe(true)
    // Everything else about the label survives.
    expect(lab.id).toBe(legacy.id)
    expect(lab.text).toBe(legacy.text)
    expect(lab.x).toBe(legacy.x)
  })

  it('is idempotent and leaves every other label as the same object', () => {
    const once = normalizeLabelGlow(legacy)
    expect(normalizeLabelGlow(once)).toBe(once)
    const plain = { ...newLabel(), theme: 'light' as const }
    expect(normalizeLabelGlow(plain)).toBe(plain)
    const glowing = { ...newLabel(), glow: true }
    expect(normalizeLabelGlow(glowing)).toBe(glowing)
  })
})

describe('the glow is paint-only', () => {
  const board = { x: 0, y: 0, w: 1000, h: 1000 }
  const base = { ...newLabel(0.5, 0.4), text: 'Glow\nover a photo', size: 42, align: 'left' as const }
  const layout = (patch: { theme?: 'dark' | 'light', glow?: boolean }) =>
    labelLineLayout({ ...base, ...patch }, board, 1, false)

  it('leaves the line layout identical with and without the effect', () => {
    const dark = layout({ theme: 'dark' })
    expect(layout({ theme: 'light' })).toEqual(dark)
    expect(layout({ theme: 'dark', glow: true })).toEqual(dark)
    expect(layout({ theme: 'light', glow: true })).toEqual(dark)
    // The effect is not part of the box either: same origin, same size.
    expect(layout({ theme: 'dark', glow: true }).box).toEqual(dark.box)
    expect(layout({ theme: 'dark', glow: true }).lines.map(l => ({ text: l.text, x: l.x, baseline: l.baseline })))
      .toEqual(dark.lines.map(l => ({ text: l.text, x: l.x, baseline: l.baseline })))
  })
})
