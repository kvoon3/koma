/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { boardColumn, CAPTION_GAP, CAPTION_H, CARD_RING, CARD_SCALE, DOCK_CHROME_H, FLOAT_ACTIONS, RECEDE_GAP, RECEDE_SCALE, RECEDE_SCALE_MIN, recedeFit, STAGE_PAD_Y, stageTopPad, switcherMetrics } from './switcherLayout'

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

/**
 * The caption chips (workspace / snapshot, centred over the 3×3) and the
 * floating action cluster (undo / redo / history / reset, pinned top-right)
 * share a horizontal band exactly on the phones: there the column has to start
 * below the buttons, and the pad it gets is the cluster's whole row plus the
 * caption's own air. Everywhere wider the two bands never meet and the pad is
 * the plain stage air: the desktop layout does not move.
 */
describe('stageTopPad', () => {
  test('every phone width seats the caption below the floating cluster', () => {
    // The widths phones really render at, coarse pointer, buttons at 38px.
    for (const stageW of [320, 360, 375, 390, 402, 414, 428, 440]) {
      expect(stageTopPad(stageW, true))
        .toBe(FLOAT_ACTIONS.offset + FLOAT_ACTIONS.btn.coarse + CAPTION_GAP + (FLOAT_ACTIONS.btn.coarse - CAPTION_H) / 2)
    }
  })

  test('a band that has pulled apart pays nothing', () => {
    // iPads and desktops, coarse or fine: the centred chips stop short of the
    // cluster with room to spare, so the pad is the stage's plain air.
    for (const stageW of [768, 834, 1024, 1280, 1440, 1920])
      expect(stageTopPad(stageW, true)).toBe(STAGE_PAD_Y)
    expect(stageTopPad(1280, false)).toBe(STAGE_PAD_Y)
    // A fine pointer only meets the cluster on windows narrower than any
    // desktop runs; the phones' 375 there still pays, with the small button.
    expect(stageTopPad(320, false)).toBe(FLOAT_ACTIONS.offset + FLOAT_ACTIONS.btn.fine + CAPTION_GAP)
    expect(stageTopPad(400, false)).toBe(STAGE_PAD_Y)
  })

  test('the pad clears the cluster by the caption gap, at rest and when squeezed', () => {
    // The invariant the pad exists for: with a height-limited column (the
    // geometry that rode up under the buttons) the chips' top edge, the row
    // top less the coarse chips' overhang, sits below the cluster's bottom
    // edge by at least the caption gap.
    const clusterBottom = FLOAT_ACTIONS.offset + FLOAT_ACTIONS.btn.coarse
    const overhang = (FLOAT_ACTIONS.btn.coarse - CAPTION_H) / 2
    for (const [stageW, stageH] of [[375, 781], [360, 609], [320, 537], [390, 813], [428, 795]]) {
      const pad = stageTopPad(stageW, true)
      expect(pad).toBeGreaterThan(STAGE_PAD_Y)
      // A board tall enough to fill the area: the column cannot centre lower.
      const areaH = stageH - pad - STAGE_PAD_Y - DOCK_CHROME_H
      const boardH = Math.max(1, areaH - CAPTION_H - CAPTION_GAP)
      const { top } = boardColumn(stageH, boardH, pad)
      expect(top).toBeGreaterThanOrEqual(pad)
      expect(top - overhang).toBeGreaterThanOrEqual(clusterBottom + CAPTION_GAP)
    }
  })
})

/**
 * The receding column must sit ENTIRELY below the strip. The board recedes in
 * place (a scale about the column's centre) while the strip is pinned to the
 * stage's top, so on every stage where the column comes near to filling its
 * area (the whole desktop range, which is height-limited) the scaled board's
 * top row used to land under the strip and be covered by it. Measured: 1280x900
 * covered 33px of the board, 1280x600 45px, 740x360 all nine slots.
 *
 * These are the stage heights of the sweep's viewports (viewport height less
 * the 31px titlebar); the board heights come from the layout model below.
 */
const STAGE_HEIGHTS = [869, 569, 737, 381, 344, 329, 781, 669]

/** A board gap the store ships with. */
const GAP = 10

/**
 * The board heights a stage really has to survive: the smallest board (nine
 * cells at the 60px floor) and the largest one the stage's area allows (the
 * height-limited board, where the top row is squeezed against the strip).
 */
function boardHeights(stageH: number): number[] {
  const area = stageH - STAGE_PAD_Y * 2 - DOCK_CHROME_H
  const smallest = 3 * 60 + 2 * GAP
  const largest = Math.max(smallest, area - CAPTION_H - CAPTION_GAP)
  return [smallest, Math.round((smallest + largest) / 2), largest]
}

describe('recedeFit', () => {
  test('the whole column lands below the strip, inside the stage', () => {
    for (const stageH of STAGE_HEIGHTS) {
      const { stripTop, stripH } = switcherMetrics(stageH)
      for (const boardH of boardHeights(stageH)) {
        const fit = recedeFit({ stageH, boardH, stripTop, stripH })
        expect(fit.fits).toBe(true)
        // The brief's own floor: a visible gap, not a hairline touch.
        expect(fit.top).toBeGreaterThanOrEqual(stripTop + stripH + 8)
        expect(fit.columnTop).toBeGreaterThanOrEqual(stripTop + stripH + 8)
        expect(fit.bottom).toBeLessThanOrEqual(stageH)
        // It is still a recede: no larger than the zoom-out, never tiny.
        expect(fit.scale).toBeLessThanOrEqual(RECEDE_SCALE)
        expect(fit.scale).toBeGreaterThanOrEqual(RECEDE_SCALE_MIN)
        // And it is still the board: nine cells tall, not a sliver.
        expect(fit.bottom - fit.top).toBeCloseTo(boardH * fit.scale, 6)
        // The caption row above it, at the same scale.
        expect(fit.top - fit.columnTop).toBeCloseTo((CAPTION_H + CAPTION_GAP) * fit.scale, 6)
      }
    }
  })

  test('the gap is the strip air, wherever the shift is doing the work', () => {
    for (let stageH = 240; stageH <= 1400; stageH += 20) {
      const { stripTop, stripH } = switcherMetrics(stageH)
      for (const boardH of boardHeights(stageH)) {
        const fit = recedeFit({ stageH, boardH, stripTop, stripH })
        if (fit.translateY === 0) {
          // No shift needed: the column is already clear of the strip.
          expect(fit.columnTop).toBeGreaterThan(stripTop + stripH)
        }
        else {
          // Shifted: it lands exactly on the strip's air, not further down.
          expect(fit.columnTop).toBeGreaterThanOrEqual(stripTop + stripH + RECEDE_GAP)
          expect(fit.columnTop).toBeLessThan(stripTop + stripH + RECEDE_GAP + 1)
        }
      }
    }
  })

  test('a tall stage keeps the recede exactly as it was', () => {
    // 375x812: the column is well clear of the strip already, so the fix must
    // not move it (the entry morph lands where it always did).
    const stageH = 781
    const boardH = 323
    const { stripTop, stripH } = switcherMetrics(stageH)
    const fit = recedeFit({ stageH, boardH, stripTop, stripH })
    expect(fit.scale).toBe(RECEDE_SCALE)
    expect(fit.translateY).toBe(0)
    const column = boardColumn(stageH, boardH)
    const centre = column.top + column.h / 2
    expect(fit.columnTop).toBeCloseTo(centre - (column.h / 2) * RECEDE_SCALE, 6)
    expect(fit.top).toBeCloseTo(centre + (column.top + CAPTION_H + CAPTION_GAP - centre) * RECEDE_SCALE, 6)
  })

  test('the phone pad rides through the recede untouched', () => {
    // The recede departs from the column's rest position, which the phone pad
    // lowered: the shift is computed from that padded position, so the receded
    // column still lands on the strip's air, not where the un-padded geometry
    // would have put it, and never through the stage's floor.
    for (const [stageW, stageH] of [[375, 781], [360, 609], [320, 537], [428, 795]]) {
      const pad = stageTopPad(stageW, true)
      expect(pad).toBeGreaterThan(STAGE_PAD_Y)
      const { stripTop, stripH } = switcherMetrics(stageH)
      const areaH = stageH - pad - STAGE_PAD_Y - DOCK_CHROME_H
      const boardH = Math.max(1, areaH - CAPTION_H - CAPTION_GAP)
      const fit = recedeFit({ stageH, boardH, stripTop, stripH, topPad: pad })
      // The shift departs from the padded rest geometry, exactly.
      const column = boardColumn(stageH, boardH, pad)
      const centre = column.top + column.h / 2
      const naturalTop = centre - (column.h / 2) * fit.scale
      const fitTop = stripTop + stripH + RECEDE_GAP
      expect(fit.translateY).toBeCloseTo(Math.max(0, fitTop - naturalTop), 2)
      // And it lands below the strip, inside the stage.
      expect(fit.columnTop).toBeGreaterThanOrEqual(fitTop - 1)
      expect(fit.bottom).toBeLessThanOrEqual(stageH)
    }
  })

  test('a height-limited stage would have put the top row under the strip', () => {
    // The regression: 1280x600's stage (569px) with its full board (362px).
    // The plain zoom-out about the column's centre leaves the board's top edge
    // above the strip's bottom edge (the reported bug); the fit clears it.
    const stageH = 569
    const boardH = 362
    const { stripTop, stripH } = switcherMetrics(stageH)
    const column = boardColumn(stageH, boardH)
    const centre = column.top + column.h / 2
    const plainTop = centre + (column.top + CAPTION_H + CAPTION_GAP - centre) * RECEDE_SCALE
    expect(plainTop).toBeLessThan(stripTop + stripH)
    const fit = recedeFit({ stageH, boardH, stripTop, stripH })
    expect(fit.top).toBeGreaterThan(stripTop + stripH)
    expect(fit.translateY).toBeGreaterThan(0)
    // The shift alone cannot cover it: the board's own room is 361px and the
    // board is 362px at 0.65, so this geometry does not need the scale.
    expect(fit.scale).toBe(RECEDE_SCALE)
  })

  test('the scale is the last lever: it only shrinks when the room runs out', () => {
    // Stages short enough that the column cannot sit at RECEDE_SCALE under the
    // strip even shifted to its air: 240 and 300 are under the ~310px the
    // smallest column needs there.
    for (const stageH of [240, 300]) {
      const { stripTop, stripH } = switcherMetrics(stageH)
      const fit = recedeFit({ stageH, boardH: 200, stripTop, stripH })
      expect(fit.scale).toBeLessThan(RECEDE_SCALE)
      expect(fit.scale).toBeGreaterThanOrEqual(RECEDE_SCALE_MIN)
      // Pushed down to the strip's air either way, never under the strip.
      expect(fit.columnTop).toBeGreaterThanOrEqual(stripTop + stripH)
    }
    // The shortest stage the sweep drives (740x360, 329px) still fits whole at
    // the plain recede scale: the shift alone does it, no visible shrink.
    for (const stageH of [329, 344, 381]) {
      const { stripTop, stripH } = switcherMetrics(stageH)
      const fit = recedeFit({ stageH, boardH: 200, stripTop, stripH })
      expect(fit.scale).toBe(RECEDE_SCALE)
      expect(fit.fits).toBe(true)
      expect(fit.columnTop).toBeGreaterThanOrEqual(stripTop + stripH + 8)
    }
    // And a stage where the floor is all that is left: it still pins the column
    // to the strip's air rather than letting it sit under the strip.
    for (const stageH of [200, 220]) {
      const { stripTop, stripH } = switcherMetrics(stageH)
      const fit = recedeFit({ stageH, boardH: 200, stripTop, stripH })
      expect(fit.scale).toBe(RECEDE_SCALE_MIN)
      expect(fit.fits).toBe(false)
      expect(fit.columnTop).toBeGreaterThanOrEqual(stripTop + stripH)
    }
  })
})
