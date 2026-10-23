import type { TKey } from './locales/zh-Hans'
import type { PaneLabel, Sticker } from './panes'
import type { RailFormat, RailScale } from './scaleRail'
import {
  DEFAULT_STICKER_SCALE,
  MAX_STICKER_SCALE,
  MIN_STICKER_SCALE,
  useStore,
} from '../store'
import { DEFAULT_LABEL_SIZE, MAX_LABEL_SIZE, MIN_LABEL_SIZE } from './panes'
import { CANVAS_SCALE } from './scaleRail'

/**
 * What the size rail is sizing (`components/ScaleRail`), decided from the
 * board's selection.
 *
 * The rail is one control with three targets. A sticker and a text label scale
 * uniformly and want no aspect control, which is exactly what a single scale is;
 * the canvas is the same (a scale, plus its own corner handle for the ratio).
 */

export type ScaleTargetKind = 'canvas' | 'sticker' | 'label'

export interface ScaleTarget {
  kind: ScaleTargetKind
  /** The object's id, '' for the canvas (there is one board size). */
  id: string
  /** The value the target holds now: a canvas fill, a sticker's `s`, a label's size. */
  value: number
  scale: RailScale
  format: RailFormat
  /** The i18n key naming the thing being sized (the slider's `aria-label`). */
  label: TKey
}

/**
 * The sticker line: `s` is the sticker's width as a share of the canvas's short
 * edge, and a fresh one lands at `DEFAULT_STICKER_SCALE`.
 */
export const STICKER_SCALE: RailScale = {
  min: MIN_STICKER_SCALE,
  max: MAX_STICKER_SCALE,
  step: 0.1,
  ref: DEFAULT_STICKER_SCALE,
}

/**
 * The label line: the text's size in canvas units, where 1000 is the canvas's
 * short edge, so the readout is the number the label was made at.
 */
export const LABEL_SCALE: RailScale = {
  min: MIN_LABEL_SIZE,
  max: MAX_LABEL_SIZE,
  step: 10,
  ref: DEFAULT_LABEL_SIZE,
}

/** The board's selection and the one size it always carries, as the rail reads it. */
export interface ScaleSelection {
  canvasFill: number
  labels: readonly PaneLabel[]
  stickers: readonly Sticker[]
  /** The selected label / sticker; the two are mutually exclusive in the store. */
  labelSel: string | null
  stickerSel: string | null
}

/** The canvas line: the board's fill, the target when nothing else is selected. */
export function canvasScaleTarget(canvasFill: number): ScaleTarget {
  return { kind: 'canvas', id: '', value: canvasFill, scale: CANVAS_SCALE, format: 'percent', label: 'Canvas size' }
}

/**
 * A selection that names something no longer on the board falls through, so a
 * removed sticker cannot leave the rail pointing at a ghost.
 */
export function pickScaleTarget(sel: ScaleSelection): ScaleTarget {
  const label = sel.labelSel ? sel.labels.find(l => l.id === sel.labelSel) : undefined
  if (label)
    return { kind: 'label', id: label.id, value: label.size, scale: LABEL_SCALE, format: 'size', label: 'Text size' }
  const sticker = sel.stickerSel ? sel.stickers.find(s => s.id === sel.stickerSel) : undefined
  if (sticker)
    return { kind: 'sticker', id: sticker.id, value: sticker.s, scale: STICKER_SCALE, format: 'percent', label: 'Sticker size' }
  return canvasScaleTarget(sel.canvasFill)
}

/**
 * The rail's tooltip: the canvas double-clicks back to the stage fit, an object
 * back to the size it was made at (both are the target's `ref`).
 */
export function scaleTargetHint(target: ScaleTarget): TKey {
  return target.kind === 'canvas'
    ? 'Drag to resize the canvas · double-click to fit'
    : 'Drag to resize · double-click to reset'
}

/**
 * Write a new value through the action that owns it. Each of the three is
 * already a gesture in the history (`setCanvasFill`, `scaleSticker:<id>`,
 * `setLabel:<id>`), so one drag stays one undo step.
 */
export function applyScaleTarget(target: ScaleTarget, value: number): void {
  const s = useStore.getState()
  if (target.kind === 'canvas')
    s.setCanvasFill(value)
  else if (target.kind === 'sticker')
    s.scaleSticker(target.id, value)
  else
    s.setLabel(target.id, { size: value })
}
