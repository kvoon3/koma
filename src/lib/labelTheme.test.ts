/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { labelLineLayout } from './exporter'
import { DEFAULT_LABEL_THEME, LABEL_GLOW_LAYERS, LABEL_THEME_IDS, LABEL_THEMES, labelColors, labelGlowLayers, labelPaint, labelTextShadow, newLabel } from './panes'

describe('label theme registry', () => {
  it('lists every theme once, default first', () => {
    expect([...LABEL_THEME_IDS].sort() as string[]).toEqual(Object.keys(LABEL_THEMES).sort())
    expect(new Set(LABEL_THEME_IDS).size).toBe(LABEL_THEME_IDS.length)
    expect<string>(LABEL_THEME_IDS[0]).toBe(DEFAULT_LABEL_THEME)
  })

  it('resolves the glow id to its own pair, not the default', () => {
    expect(labelColors('glow')).toBe(LABEL_THEMES.glow)
    expect(labelColors('glow').fg).toBe('#ffffff')
    expect(labelColors('glow').bg).toBe('transparent')
  })

  it('falls back to the default for a missing or unknown theme (old sessions)', () => {
    expect(labelColors(undefined)).toBe(LABEL_THEMES.dark)
    expect(labelColors('neon' as never)).toBe(LABEL_THEMES.dark)
    expect(labelTextShadow(undefined)).toBeUndefined()
    expect(labelGlowLayers('light')).toBeUndefined()
  })

  it('paints the glow as white text with no box', () => {
    const paint = labelPaint({ theme: 'glow' })
    expect(paint.fg).toBe('#ffffff')
    expect(paint.fill).toBe('transparent')
    // A custom text color still wins, exactly like the box themes.
    expect(labelPaint({ theme: 'glow', fg: '#ff0000' }).fg).toBe('#ff0000')
  })

  it('spells the halo as one em-relative CSS stack', () => {
    const shadow = labelTextShadow('glow')!
    const parts = shadow.match(/0 0 [^)]+\)/g)!
    expect(parts).toHaveLength(LABEL_GLOW_LAYERS.length)
    // CSS paints back to front: the tight blue rim is listed first, the wide
    // halo last.
    expect(parts[0]).toContain('0.05em')
    expect(parts[0]).toContain('rgba(40, 120, 255, 1)')
    expect(parts[3]).toContain('0.5em')
    expect(parts[3]).toContain('rgba(70, 140, 255, 0.85)')
    for (const part of parts)
      expect(part.startsWith('0 0 ')).toBe(true)
    expect(labelTextShadow('dark')).toBeUndefined()
  })
})

describe('the glow is paint-only', () => {
  const board = { x: 0, y: 0, w: 1000, h: 1000 }
  const base = { ...newLabel(0.5, 0.4), text: 'Glow\nover a photo', size: 42, align: 'left' as const }
  const layout = (theme: 'dark' | 'light' | 'glow' | undefined) =>
    labelLineLayout({ ...base, theme } as never, board, 1, false)

  it('leaves the line layout identical with and without the theme', () => {
    const dark = layout('dark')
    expect(layout('glow')).toEqual(dark)
    expect(layout('light')).toEqual(dark)
    expect(layout(undefined)).toEqual(dark)
    // The theme is not part of the box either: same origin, same size.
    expect(layout('glow').box).toEqual(dark.box)
    expect(layout('glow').lines.map(l => ({ text: l.text, x: l.x, baseline: l.baseline })))
      .toEqual(dark.lines.map(l => ({ text: l.text, x: l.x, baseline: l.baseline })))
  })
})
