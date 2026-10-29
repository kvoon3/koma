/**
 * The board manager's fit-to-viewport layout: how many columns and rows the
 * cards take and exactly how large each card is, so one to four boards are all
 * on screen without a scrollbar. Pure, so the fit is tested at every viewport
 * the app ships for rather than eyeballed.
 *
 * Cards hold a 3×3 thumbnail over a bottom bar. The thumbnail's cells keep the
 * board's own cell ratio (the grid's cell aspect is a global setting), so the
 * card's height follows from its width; the layout picks the arrangement that
 * makes the card largest.
 */

export const MANAGER_INSET = 16
export const MANAGER_GAP = 16
export const MANAGER_PAD = 10
export const MANAGER_BAR_H = 48
export const MANAGER_THUMB_GAP = 2
/** The dialog's header and footer rows, for callers measuring the whole popup. */
export const MANAGER_HEADER_H = 56
export const MANAGER_FOOTER_H = 68

export interface ManagerLayoutInput {
  /** Boards in the manager (1–4 today). */
  count: number
  /** The dialog content area's width and height, px. */
  viewW: number
  viewH: number
  /** The board cells' width / height (the grid's cell ratio). */
  ratio: number
}

export interface ManagerLayout {
  cols: number
  rows: number
  cardW: number
  cardH: number
  thumbW: number
  thumbH: number
  gap: number
  inset: number
}

/**
 * The card width an arrangement can afford: the narrower of the column width
 * and the width at which the thumbnail plus bar still fits the row height.
 */
function cardWidthFor(cols: number, rows: number, viewW: number, viewH: number, ratio: number, gap: number, inset: number): number {
  const availW = Math.max(1, viewW - inset * 2)
  const availH = Math.max(1, viewH - inset * 2)
  const widthPerCol = (availW - gap * (cols - 1)) / cols
  const heightPerRow = (availH - gap * (rows - 1)) / rows
  const byHeight = Math.max(0, heightPerRow - 2 * MANAGER_THUMB_GAP - 2 * MANAGER_PAD - MANAGER_BAR_H) * ratio
    + 2 * MANAGER_PAD + 2 * MANAGER_THUMB_GAP
  return Math.max(0, Math.min(widthPerCol, byHeight))
}

/**
 * The arrangement with the largest card that still fits. Equal card sizes
 * prefer fewer empty cells, then fewer columns, so the result is stable.
 */
export function managerLayout({ count, viewW, viewH, ratio }: ManagerLayoutInput): ManagerLayout {
  const cards = Math.max(1, Math.trunc(count))
  const safeRatio = ratio > 0 && Number.isFinite(ratio) ? ratio : 1
  let best = { cols: 1, rows: cards, cardW: 0, empty: 0 }
  for (let cols = 1; cols <= cards; cols++) {
    const rows = Math.ceil(cards / cols)
    const cardW = cardWidthFor(cols, rows, viewW, viewH, safeRatio, MANAGER_GAP, MANAGER_INSET)
    const empty = cols * rows - cards
    const better = cardW > best.cardW + 0.5
      || (Math.abs(cardW - best.cardW) <= 0.5 && (empty < best.empty || (empty === best.empty && cols < best.cols)))
    if (better)
      best = { cols, rows, cardW, empty }
  }
  const cardW = Math.max(1, Math.floor(best.cardW))
  const thumbW = Math.max(1, cardW - 2 * MANAGER_PAD)
  const thumbH = (thumbW - 2 * MANAGER_THUMB_GAP) / safeRatio + 2 * MANAGER_THUMB_GAP
  const cardH = thumbH + 2 * MANAGER_PAD + MANAGER_BAR_H
  return { cols: best.cols, rows: best.rows, cardW, cardH, thumbW, thumbH, gap: MANAGER_GAP, inset: MANAGER_INSET }
}

export function thumbnailCell(thumbW: number, thumbH: number, ratio: number, gap = MANAGER_THUMB_GAP): { w: number, h: number } {
  const safeRatio = ratio > 0 && Number.isFinite(ratio) ? ratio : 1
  const byW = (thumbW - gap * 2) / 3
  const byH = ((thumbH - gap * 2) / 3) * safeRatio
  const w = Math.max(1, Math.floor(Math.min(byW, byH)))
  return { w, h: Math.max(1, Math.round(w / safeRatio)) }
}
