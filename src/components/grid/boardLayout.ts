/**
 * The overview's layout tokens: the board column's caption row, the stage air,
 * and the floating action cluster the column clears on a phone. Kept out of the
 * component so the board slot math stays pure and testable.
 */

/**
 * The board column's caption row (the workspace and snapshot chips). It is part
 * of the column, so its height counts against the board's slot.
 */
export const CAPTION_H = 30

/** Air under a caption row, over its board. */
export const CAPTION_GAP = 8

/** Air the stage keeps above and below a board. */
export const STAGE_PAD_Y = 12

/**
 * The floating action cluster (undo / redo / history / reset) pinned over the
 * stage's top-right corner. The caption chips over the 3x3 are centred, so on a
 * stage narrow enough the two share a horizontal band: every phone, never a
 * desktop or a tablet. There the column has to start below the buttons instead
 * of running under them. Kept as numbers so the stage geometry stays pure;
 * FloatActions and the caption own the classes, these mirror them.
 */
export const FLOAT_ACTIONS = {
  /** The cluster's `top-2.5` / `right-2.5` offset. */
  offset: 10,
  /** One button's edge, per pointer type. */
  btn: { fine: 30, coarse: 38 } as const,
  /** Buttons in the row, and the `gap-1.5` between them. */
  count: 4,
  gap: 6,
} as const

/**
 * The top padding the board stage keeps so the caption chips clear the floating
 * action cluster: the plain stage air where the two never share a horizontal
 * band, and the cluster's whole row plus the caption's own air where they do.
 * Paid out of the board's slot, not painted over.
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
