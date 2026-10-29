/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { boardBody, boardRows, boardSlot, CAPTION_GAP, CAPTION_H, DOCK_CHROME_H, DOTS_ROW_H, dotsBottom, FLOAT_ACTIONS, maxRows, slotH, STAGE_PAD_Y, stageCellBox, stageTopPad } from './overviewLayout'

describe('boardRows', () => {
  test('counts the + cell as a slot until the board is full', () => {
    expect(boardRows(1)).toBe(1)
    expect(boardRows(2)).toBe(1)
    expect(boardRows(3)).toBe(2)
    expect(boardRows(5)).toBe(2)
    expect(boardRows(6)).toBe(3)
    expect(boardRows(8)).toBe(3)
    expect(boardRows(9)).toBe(3)
  })
})

describe('maxRows', () => {
  test('takes the tallest board in the row, whatever the order', () => {
    expect(maxRows([8])).toBe(3)
    expect(maxRows([1, 2, 8, 4])).toBe(3)
    expect(maxRows([1, 2, 1])).toBe(1)
    expect(maxRows([])).toBe(1)
    // The active board never enters the function: every page reserves the
    // same slot height, so paging cannot move a board vertically.
    expect(maxRows([1, 8])).toBe(maxRows([8, 1]))
  })
})

describe('slotH', () => {
  test('reserves the tallest board plus the gaps between rows', () => {
    expect(slotH(1, 100, 10)).toBe(100)
    expect(slotH(2, 100, 10)).toBe(210)
    expect(slotH(3, 100, 10)).toBe(320)
    // Every page uses the same slotH for a fixed maxRows: a short board is
    // centred inside it, so its cells never move when the page changes.
    const boxH = 100
    for (const counts of [[8, 1], [8, 3], [8, 5]])
      expect(slotH(maxRows(counts), boxH, 10)).toBe(320)
  })
})

describe('boardBody', () => {
  test('takes the dots row out of the board budget', () => {
    expect(boardBody(812, STAGE_PAD_Y, 144)).toBe(812 - STAGE_PAD_Y - STAGE_PAD_Y - 144 - DOTS_ROW_H)
    expect(DOTS_ROW_H).toBe(28)
    expect(dotsBottom(144)).toBe(144 + STAGE_PAD_Y)
  })

  test('a stage shorter than its chrome still gets a positive body', () => {
    expect(boardBody(100, 30, 144)).toBe(1)
  })
})

describe('stageCellBox', () => {
  const body = { w: 327, h: 520 }

  test('fits three columns and three rows inside the slot', () => {
    for (const ratio of [1, 0.8, 0.75, 16 / 9]) {
      const { cell, box } = stageCellBox(body, 10, ratio)
      const slot = boardSlot(body)
      expect(cell * 3 + 20).toBeLessThanOrEqual(slot.w)
      expect(box.h * 3 + 20).toBeLessThanOrEqual(slot.h)
      expect(box.w).toBe(cell)
    }
  })

  test('flips the board parity when the leftover is odd, so cells land on whole pixels', () => {
    for (const w of [320, 327, 360, 375, 414]) {
      const { cell } = stageCellBox({ w, h: 520 }, 10, 1)
      const slot = boardSlot({ w, h: 520 })
      expect((slot.w - (cell * 3 + 20)) % 2).toBe(0)
    }
  })

  test('fits a short stage above the dots at the 44px floor', () => {
    const short = { w: 375 - 40, h: boardBody(412, STAGE_PAD_Y, 144) }
    const { cell, box } = stageCellBox(short, 10, 1)
    expect(cell).toBe(52)
    expect(cell).toBeGreaterThanOrEqual(44)
    expect(box.h * 3 + 20).toBeLessThanOrEqual(boardSlot(short).h)
  })

  test('never returns a cell below the 44px tap target', () => {
    const tight = { w: 100, h: boardBody(200, STAGE_PAD_Y, 144) }
    const { cell } = stageCellBox(tight, 10, 1)
    expect(cell).toBe(44)
  })
})

describe('stageTopPad', () => {
  test('narrow phones seat the caption below the floating cluster', () => {
    // The widths whose centred chip still reaches the cluster, coarse, 38px buttons.
    for (const stageW of [320, 360, 375, 390]) {
      expect(stageTopPad(stageW, true))
        .toBe(FLOAT_ACTIONS.offset + FLOAT_ACTIONS.btn.coarse + CAPTION_GAP + (FLOAT_ACTIONS.btn.coarse - CAPTION_H) / 2)
    }
  })

  test('a wider phone clears the cluster with the plain air', () => {
    for (const stageW of [402, 414, 428, 440])
      expect(stageTopPad(stageW, true)).toBe(STAGE_PAD_Y)
  })

  test('a band that has pulled apart pays nothing', () => {
    // iPads and desktops, coarse or fine: the centred chip stops short of the
    // cluster with room to spare, so the pad is the stage's plain air.
    for (const stageW of [768, 834, 1024, 1280, 1440, 1920])
      expect(stageTopPad(stageW, true)).toBe(STAGE_PAD_Y)
    expect(stageTopPad(1280, false)).toBe(STAGE_PAD_Y)
    // A fine pointer only meets the cluster on windows narrower than any
    // desktop runs; the phones' 375 there still pays, with the small button.
    expect(stageTopPad(320, false)).toBe(FLOAT_ACTIONS.offset + FLOAT_ACTIONS.btn.fine + CAPTION_GAP)
    expect(stageTopPad(400, false)).toBe(STAGE_PAD_Y)
  })

  test('the pad clears the cluster by the caption gap at rest', () => {
    const clusterBottom = FLOAT_ACTIONS.offset + FLOAT_ACTIONS.btn.coarse
    const overhang = (FLOAT_ACTIONS.btn.coarse - CAPTION_H) / 2
    for (const [stageW, stageH] of [[375, 781], [360, 609], [320, 537], [390, 813]]) {
      const pad = stageTopPad(stageW, true)
      expect(pad).toBeGreaterThan(STAGE_PAD_Y)
      // A board tall enough to fill the area: the column cannot centre lower.
      const body = boardBody(stageH, pad, DOCK_CHROME_H)
      const slot = boardSlot({ w: stageW - 40, h: body })
      const columnH = CAPTION_H + CAPTION_GAP + slot.h
      const top = pad + Math.max(0, (body - columnH) / 2)
      expect(top).toBeGreaterThanOrEqual(pad)
      expect(top - overhang).toBeGreaterThanOrEqual(clusterBottom + CAPTION_GAP)
    }
  })
})
