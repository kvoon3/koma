/**
 * The switcher's geometry, kept out of the component file (a module of
 * constants and one pure function, so the component file only exports
 * components). The overview sizes the stage with these too.
 */
import type { Node, PaneLabel, Sticker } from '../../lib/panes'

/**
 * How far the board recedes behind the switcher (an app shrinking down). This
 * is the most it recedes: `recedeFit` keeps the whole column below the strip,
 * so a stage too short for it gets less. The pager needs the scale that was
 * actually used because the board pans inside it: its own translate is divided
 * by that, so the board still tracks the finger 1:1 on screen.
 */
export const RECEDE_SCALE = 0.65

/**
 * How far it dims while receded. It used to sit at 0.45, where an all-empty
 * board (a fresh session: nine quiet squares on an equally pale stage) dimmed
 * into the backdrop and the switcher read as an empty gray screen. At 0.6 with
 * the hairline the quiet cells wear, the 3×3 stays legible; the 40% dim layer
 * over the whole stage is still what sets the board behind the strip, so the
 * recede reads as a recede and not as an un-dimmed board.
 */
export const RECEDE_OPACITY = 0.6

/**
 * How much it blurs. 3px smeared the empty cells' hairlines away entirely
 * (measured: 1/255 between line and fill); 2px keeps the structure and still
 * reads as the board behind glass.
 */
export const RECEDE_BLUR = 2

/**
 * How much larger the open group's card stands. The strip's metrics resize
 * around it: see `switcherMetrics` (the ring must fit inside the strip).
 */
export const CARD_SCALE = 1.08

/** The selection ring around that card: a 2px outline at 1px offset. */
export const CARD_RING = 3

/**
 * The board column's caption row (the workspace and snapshot chips). It is
 * part of the column the recede transforms, so its height is part of the fit.
 */
export const CAPTION_H = 30

/** Air under a caption row, over its board. */
export const CAPTION_GAP = 8

/** Air the stage keeps above and below a board. */
export const STAGE_PAD_Y = 12

/**
 * The chrome the dock keeps at the bottom of the stage on the overview route.
 * A first-frame fallback only: the component measures the sheet's real top
 * edge (the sheet height moves with its icons / row / expanded displays), and
 * hands the measured band to `boardColumn` and `recedeFit` as `dockH`.
 */
export const DOCK_CHROME_H = 144

/**
 * The floating action cluster (undo / redo / history / reset) pinned over the
 * stage's top-right corner (FloatActions). The caption chips over the 3×3 are
 * centred, so on a stage narrow enough the two share a horizontal band: every
 * phone, never a desktop or a tablet. There the column has to start below the
 * buttons instead of running under them. Kept here as numbers (not a live
 * measurement) so the stage's geometry stays pure: FloatActions and
 * BoardCaption own the classes; these mirror them and drift if they change.
 */
export const FLOAT_ACTIONS = {
  /** The cluster's `top-2.5` / `right-2.5` offset. */
  offset: 10,
  /** One button's edge, per pointer type: the same `pointer-coarse` step the
   * buttons take, and the caption chips are the same square. */
  btn: { fine: 30, coarse: 38 } as const,
  /** Buttons in the row, and the `gap-1.5` between them. */
  count: 4,
  gap: 6,
} as const

/**
 * The top padding the board stage keeps so the caption chips clear the
 * floating action cluster: the plain stage air where the two never share a
 * horizontal band, and the cluster's whole row plus the caption's own air
 * where they do. Paid out of the board's slot (like the dock's chrome at the
 * bottom), not painted over. A height-limited column would otherwise ride up
 * under the buttons, which is how a phone's snapshot chip landed under undo.
 */
export function stageTopPad(stageW: number, coarse: boolean): number {
  const btn = coarse ? FLOAT_ACTIONS.btn.coarse : FLOAT_ACTIONS.btn.fine
  const clusterLeft = stageW - FLOAT_ACTIONS.offset - (FLOAT_ACTIONS.count * btn + (FLOAT_ACTIONS.count - 1) * FLOAT_ACTIONS.gap)
  // The chips are centred, so their half-span is one chip and half the gap.
  const chipsRight = stageW / 2 + btn + FLOAT_ACTIONS.gap / 2
  if (chipsRight <= clusterLeft)
    return STAGE_PAD_Y
  // On a coarse pointer the chips stand taller than the caption row itself;
  // the half that overflows the row's top has to clear the cluster too.
  return FLOAT_ACTIONS.offset + btn + CAPTION_GAP + Math.max(0, (btn - CAPTION_H) / 2)
}

/** A board's cells, as the pager and the cards read them. */
export type BoardCells = { id: string, root: Node, canvasRatio: number | null, stickers?: Sticker[], labels?: PaneLabel[] }[]

/** Air between the cards in the switcher strip (Mission Control's window gap). */
export const STRIP_GAP = 60

/** Air between the nine cells inside a card thumbnail. */
export const CARD_GAP = 2

/** Switcher strip geometry: air above it, its own height, card sizes. */
export function switcherMetrics(stageH: number) {
  const baseH = Math.max(96, Math.round(stageH * 0.125))
  const stripTop = Math.max(8, Math.round(stageH * 0.09))
  // Nothing is written under a card any more, so the thumbnail takes the whole
  // height, less the air the ring needs.
  const cardH = Math.max(36, baseH - 16)
  const cardW = Math.max(56, Math.round(cardH * 1.6))
  /**
   * Air above and below a card, which has to hold the enlarged card's ring.
   * The cards sit in an `overflow-x` scroll box, and a scroll box has no
   * visible overflow on the other axis (`overflow-y` computes to `auto`): it
   * clips at its padding box, and the strip clips at the same edge. With 6px
   * of air the ring's top and bottom edges fell outside that clip and the
   * selection read as two vertical rails down the strip's full height. Three
   * of the air's pixels stay empty, so the ring never fuses with the strip's
   * own hairline.
   */
  const air = Math.ceil(((CARD_SCALE - 1) * cardH) / 2 + CARD_RING) + 3
  const stripH = Math.max(baseH, cardH + 2 + air * 2)
  return { stripH, stripTop, cardH, cardW }
}

/**
 * Air between the strip's bottom edge and the receded column's top edge. The
 * board must read as sitting *below* the strip, not tucked under it.
 */
export const RECEDE_GAP = 12

/**
 * The smallest the fit may shrink the board. The recede is a zoom-out (the
 * board stays readable as a 3×3), so short stages get a translate before they
 * get a smaller board; this is only the point where the board stops shrinking
 * and the stage starts overflowing instead. It only comes into play under about
 * 310px of stage height (the floor itself near 255px), well below any phone:
 * the sweep's shortest stage, 329px, still fits whole at the plain recede.
 */
export const RECEDE_SCALE_MIN = 0.45

/**
 * Where the board column (the caption row over the 3×3) sits in the stage
 * before the recede: the stage's board area is the stage less its top air
 * (`topPad`, grown to clear the floating action cluster on a phone, see
 * `stageTopPad`), its bottom air and the dock's chrome, and the column is
 * centred in it. A column taller than the area overflows both ends by the same
 * amount, which is how the shortest stages (a landscape phone under the 60px
 * cell floor) render today.
 */
export function boardColumn(stageH: number, boardH: number, topPad = STAGE_PAD_Y, dockH = DOCK_CHROME_H) {
  const h = CAPTION_H + CAPTION_GAP + boardH
  const areaH = Math.max(1, stageH - topPad - STAGE_PAD_Y - dockH)
  return { top: topPad + (areaH - h) / 2, h }
}

/** The receded board's placement: the column's transform, and where the column lands. */
export interface Recede {
  /** The scale the column wears behind the switcher (`RECEDE_SCALE`, or less on a short stage). */
  scale: number
  /** How far the whole column is pushed down, in stage px (0 = it already fits). */
  translateY: number
  /** The 3×3's top and bottom edges once receded, in stage px. */
  top: number
  bottom: number
  /** The column's own top edge (its caption row), which has to clear the strip too. */
  columnTop: number
  /** It ended up whole below the strip and inside the stage (false only at the scale floor). */
  fits: boolean
}

/**
 * Fit the receding column under the strip.
 *
 * The column recedes in place (a scale about its own centre) while the strip is
 * pinned to the top of the stage, so on any stage where the column comes close
 * to filling its area (every height-limited stage, which is the whole desktop
 * range) the scaled board's top row lands under the strip and is covered by it.
 * So the recede carries the shift, and on a stage too short for it, the extra
 * scale that puts the whole column in the room between the strip and the
 * stage's floor: the morph stays one zoom-out, replaced end to end.
 *
 * The fit is on the column rather than on the 3×3 alone because the caption row
 * rides in the same transform: shifting only until the board cleared would
 * leave the top of that row (two chips, 30px at rest) cut off by the strip in
 * every geometry, which is the reported bug in miniature. Shrinking the board a
 * little on the shortest stages is the cheaper of the two, and the floor
 * (`RECEDE_SCALE_MIN`) is what stops it.
 *
 * Width is not part of the fit: the column is never wider than the stage less
 * its air, and the fit never scales past `RECEDE_SCALE`.
 */
export function recedeFit({ stageH, boardH, stripTop, stripH, topPad = STAGE_PAD_Y, dockH = DOCK_CHROME_H }: {
  /** The stage's height (the box the board and the strip are placed in). */
  stageH: number
  /** The 3×3's height as laid out, before the recede. */
  boardH: number
  /** The strip's box within the stage, from `switcherMetrics`. */
  stripTop: number
  stripH: number
  /** The stage's top air the column rests under (see `stageTopPad`). */
  topPad?: number
  /** The dock band the resting column is seated above, same as `boardColumn`. */
  dockH?: number
}): Recede {
  const column = boardColumn(stageH, boardH, topPad, dockH)
  const centre = column.top + column.h / 2
  const fitTop = stripTop + stripH + RECEDE_GAP
  const fitBottom = stageH - STAGE_PAD_Y
  const room = Math.max(1, fitBottom - fitTop)
  // Never larger than the recede itself; smaller only when the room under the
  // strip cannot hold the column. Floored, so the board stays a board.
  const scale = Math.max(RECEDE_SCALE_MIN, Math.floor(Math.min(RECEDE_SCALE, room / Math.max(1, column.h)) * 1000) / 1000)
  // Where the scaled column's top lands with no shift (a scale about the
  // column's centre, which is the transform origin the morph already uses).
  const naturalTop = centre - (column.h / 2) * scale
  // Only as far down as the column has to go: past the strip's air it stops
  // where the zoom-out leaves it. Rounded up, so the gap can only grow.
  const translateY = Math.max(0, Math.ceil((fitTop - naturalTop) * 100) / 100)
  const columnTop = naturalTop + translateY
  const boardTop = columnTop + (CAPTION_H + CAPTION_GAP) * scale
  const bottom = boardTop + boardH * scale
  return { scale, translateY, top: boardTop, bottom, columnTop, fits: columnTop >= fitTop && bottom <= stageH }
}

/**
 * How far a pull travels before it commits: down on the board to open the
 * switcher, up on the receded board to leave it. Below it the press is still a
 * click, and a mostly-horizontal drag is never a pull (see `lockedAxis`).
 */
export const PULL_COMMIT = 70

/**
 * Axis lock: a pull counts only when its own travel outweighs the other axis's
 * by this factor, so the horizontal pager and the vertical enter / exit never
 * argue over the same gesture.
 */
export const PULL_DOMINANCE = 1.2

/**
 * Which axis a gesture past the slop belongs to, decided once: sideways is the
 * pager, vertical is the switcher's enter / exit. A drag too close to the
 * diagonal has not committed to either yet (null), so nothing is hijacked.
 */
export function lockedAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) > Math.abs(dy) * PULL_DOMINANCE)
    return 'x'
  if (Math.abs(dy) > Math.abs(dx) * PULL_DOMINANCE)
    return 'y'
  return null
}

/**
 * Hand a captured pointer back, if this element still has it. The gesture
 * layers (pager, pull) both end a drag this way.
 */
export function releaseCapture(el: HTMLElement, pointerId: number) {
  if (el.hasPointerCapture(pointerId))
    el.releasePointerCapture(pointerId)
}
