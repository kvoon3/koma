/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { CAPTION_GAP, CAPTION_H, FLOAT_ACTIONS, STAGE_PAD_Y, stageTopPad } from './boardLayout'

/**
 * The caption chips (workspace / snapshot, centred over the 3x3) and the
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
      const areaH = stageH - pad - STAGE_PAD_Y - 144
      const boardH = Math.max(1, areaH - CAPTION_H - CAPTION_GAP)
      // The column centres the caption and board in that area.
      const columnTop = pad + (areaH - (CAPTION_H + CAPTION_GAP + boardH)) / 2
      expect(columnTop).toBeGreaterThanOrEqual(pad)
      expect(columnTop - overhang).toBeGreaterThanOrEqual(clusterBottom + CAPTION_GAP)
    }
  })
})
