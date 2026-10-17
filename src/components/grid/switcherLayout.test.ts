/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { CARD_RING, CARD_SCALE, switcherMetrics } from './switcherLayout'

/**
 * The cards live in an `overflow-x` scroll box, which clips both axes at its
 * padding box (the strip clips at the same edge). The open group's card stands
 * `CARD_SCALE` larger and wears the ring: if that overhang does not fit in the
 * strip's air, the ring's top and bottom edges are cut off and the selection
 * reads as two vertical rails down the strip's full height (the bug these
 * numbers exist to prevent).
 */
describe('switcherMetrics', () => {
  const stages = [240, 320, 400, 480, 560, 640, 720, 769, 869, 1024, 1200]

  test('the enlarged card and its ring fit inside the strip', () => {
    for (const stageH of stages) {
      const { stripH, cardH } = switcherMetrics(stageH)
      const ringOuter = cardH * CARD_SCALE + CARD_RING * 2
      expect(ringOuter).toBeLessThanOrEqual(stripH - 2)
    }
  })

  test('the strip still rounds to about an eighth of the stage', () => {
    // Stages tall enough for the 12.5% to clear the strip's 96px minimum
    // height; below that the floor decides and the ratio means nothing.
    for (const stageH of [800, 869, 1024, 1200]) {
      const { stripH } = switcherMetrics(stageH)
      expect(stripH / stageH).toBeGreaterThan(0.10)
      expect(stripH / stageH).toBeLessThan(0.15)
    }
  })

  test('the strip starts on the stage and clears its own height', () => {
    for (const stageH of stages) {
      const { stripTop, stripH } = switcherMetrics(stageH)
      expect(stripTop).toBeGreaterThanOrEqual(8)
      expect(stripTop + stripH).toBeLessThan(stageH)
    }
  })
})
