/// <reference types="bun" />
import type { IconNode } from 'lucide'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LabelIconGlyph } from './BoardLabel'

describe('LabelIconGlyph', () => {
  test('renders each icon node with its own SVG tag', () => {
    const node: IconNode = [
      ['circle', { cx: 12, cy: 12, r: 10 }],
      ['rect', { x: 2, y: 2, width: 20, height: 20 }],
      ['path', { d: 'M2 2L22 22' }],
    ]
    const html = renderToStaticMarkup(LabelIconGlyph({ node }))
    expect(html).toContain('<circle')
    expect(html).toContain('<rect')
    expect(html).toContain('<path')
  })
})
