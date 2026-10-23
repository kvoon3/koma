import type { PaneLabel, Sticker } from './panes'
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DEFAULT_STICKER_SCALE, MAX_CANVAS_FILL, MIN_CANVAS_FILL, useStore } from '../store'
import { DEFAULT_LABEL_SIZE, DEFAULT_LABEL_THEME } from './panes'
import { CANVAS_SCALE } from './scaleRail'
import { applyScaleTarget, canvasScaleTarget, LABEL_SCALE, pickScaleTarget, STICKER_SCALE } from './scaleTarget'

function label(id: string, size = DEFAULT_LABEL_SIZE): PaneLabel {
  return { id, text: 'x', font: '', theme: DEFAULT_LABEL_THEME, x: 0.5, y: 0.5, size }
}

const sticker = (id: string, s = DEFAULT_STICKER_SCALE): Sticker => ({ id, photoId: `p-${id}`, x: 0.5, y: 0.5, s })

const base = {
  canvasFill: 1,
  labels: [label('l1')],
  stickers: [sticker('t1')],
  labelSel: null,
  stickerSel: null,
}

describe('what the rail sizes', () => {
  test('a selected label wins, and sizes the text', () => {
    const pick = pickScaleTarget({ ...base, labelSel: 'l1', stickerSel: 't1' })
    expect(pick.kind).toBe('label')
    expect(pick.id).toBe('l1')
    expect(pick.value).toBe(DEFAULT_LABEL_SIZE)
    expect(pick.scale).toBe(LABEL_SCALE)
    expect(pick.format).toBe('size')
    expect(pick.label).toBe('Text size')
  })

  test('a selected sticker next', () => {
    const pick = pickScaleTarget({ ...base, stickerSel: 't1' })
    expect(pick.kind).toBe('sticker')
    expect(pick.id).toBe('t1')
    expect(pick.value).toBe(DEFAULT_STICKER_SCALE)
    expect(pick.scale).toBe(STICKER_SCALE)
    expect(pick.format).toBe('percent')
    expect(pick.label).toBe('Sticker size')
  })

  test('the canvas when nothing else is selected', () => {
    const pick = pickScaleTarget({ ...base, canvasFill: 1.25 })
    expect(pick.kind).toBe('canvas')
    expect(pick.value).toBe(1.25)
    expect(pick.scale).toBe(CANVAS_SCALE)
    expect(pick.format).toBe('percent')
    expect(pick.label).toBe('Canvas size')
  })

  test('no focus or selection sizes the canvas', () => {
    expect(pickScaleTarget({ ...base, labelSel: null, stickerSel: null }).kind).toBe('canvas')
    expect(pickScaleTarget({ ...base, labelSel: 'l1' }).kind).toBe('label')
    expect(pickScaleTarget({ ...base, stickerSel: 't1' }).kind).toBe('sticker')
  })

  test('a selection naming something no longer on the board falls through', () => {
    expect(pickScaleTarget({ ...base, labelSel: 'gone' }).kind).toBe('canvas')
    expect(pickScaleTarget({ ...base, labelSel: 'gone', stickerSel: 'also-gone' }).kind).toBe('canvas')
  })

  test('the canvas line carries the board fill', () => {
    expect(pickScaleTarget({ ...base, canvasFill: 0.8 })).toEqual(canvasScaleTarget(0.8))
  })

  test('the targets span what their stores accept', () => {
    expect(CANVAS_SCALE.min).toBe(MIN_CANVAS_FILL)
    expect(CANVAS_SCALE.max).toBe(MAX_CANVAS_FILL)
    // The rails write through the store's own actions, which clamp to the same
    // numbers: a rail value can never be out of reach.
    expect(LABEL_SCALE.min).toBe(12)
    expect(LABEL_SCALE.max).toBe(160)
    expect(STICKER_SCALE.min).toBeCloseTo(0.02, 9)
    expect(STICKER_SCALE.max).toBeCloseTo(1.5, 9)
  })
})

describe('applying a target writes the field it owns', () => {
  /**
   * A board carrying one label and one sticker, and the selection handed to
   * `pickScaleTarget` as the rail builds it: from the board itself.
   */
  const board = () => {
    const s = useStore.getState()
    const ws = s.workspaces.find(w => w.id === s.activeId)!
    const l = label('l-test')
    const t = sticker('t-test')
    useStore.setState({
      workspaces: s.workspaces.map(w => (w.id === ws.id
        ? { ...w, labels: [l], stickers: [t], canvasFill: 1 }
        : w)),
    })
    const sel = {
      canvasFill: 1,
      labels: [l],
      stickers: [t],
    }
    return { wsId: ws.id, sel, ws: () => useStore.getState().workspaces.find(w => w.id === ws.id)! }
  }

  test('the canvas writes its fill', () => {
    const { ws, sel } = board()
    const target = pickScaleTarget({ ...sel, labelSel: null, stickerSel: null })
    expect(target.kind).toBe('canvas')
    applyScaleTarget(target, 1.2)
    expect(ws().canvasFill).toBe(1.2)
  })

  test('a sticker writes its share of the canvas', () => {
    const { ws, sel } = board()
    const target = pickScaleTarget({ ...sel, labelSel: null, stickerSel: 't-test' })
    expect(target.kind).toBe('sticker')
    applyScaleTarget(target, 0.42)
    expect(ws().stickers.find(s => s.id === 't-test')?.s).toBe(0.42)
  })

  test('a label writes its text size', () => {
    const { ws, sel } = board()
    const target = pickScaleTarget({ ...sel, labelSel: 'l-test', stickerSel: null })
    expect(target.kind).toBe('label')
    applyScaleTarget(target, 88)
    expect(ws().labels.find(l => l.id === 'l-test')?.size).toBe(88)
  })

  test('each write is one undo step, and undo puts it back', () => {
    const { ws, sel } = board()
    const target = pickScaleTarget({ ...sel, labelSel: null, stickerSel: 't-test' })
    applyScaleTarget(target, 0.3)
    applyScaleTarget(target, 0.42)
    expect(ws().stickers.find(s => s.id === 't-test')?.s).toBe(0.42)
    useStore.getState().undo()
    expect(ws().stickers.find(s => s.id === 't-test')?.s).toBeCloseTo(0.2, 9)
  })
})
