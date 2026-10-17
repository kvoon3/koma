/**
 * The switcher's geometry, kept out of the component file (a module of
 * constants and one pure function, so the component file only exports
 * components). The overview sizes the stage with these too.
 */
import type { Node, PaneLabel, Sticker } from '../../lib/panes'

/**
 * How far the board recedes behind the switcher (an app shrinking down). The
 * pager needs it because the board pans inside this scale: its own translate
 * is divided by it so the board still tracks the finger 1:1 on screen.
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
