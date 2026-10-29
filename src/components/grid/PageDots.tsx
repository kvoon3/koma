/**
 * The page-dot pill: one dot per board, the active one elongated, in a fixed
 * scale pill at the stage's bottom centre. It is the only entry to board
 * management, so it is present with one board too. Its 28px row is reserved
 * out of the board's height (`overviewLayout`); a pseudo-element widens the tap
 * target to 44px without taking a taller row.
 */
import { useT } from '../../lib/i18n'
import { DOTS_GAP, DOTS_ROW_H } from './overviewLayout'

export function PageDots({ count, index, bottom, onOpen }: {
  count: number
  /** The page the dots mark (clamped by the caller). */
  index: number
  /** Distance from the stage's floor to the pill's bottom edge. */
  bottom: number
  onOpen: () => void
}) {
  const t = useT()
  const label = t('Manage boards ({n} of {m})', { n: index + 1, m: count })
  return (
    <button
      type="button"
      data-board-dots=""
      aria-label={label}
      title={label}
      onClick={onOpen}
      className="absolute left-1/2 z-20 flex min-w-11 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-float-line bg-float-bg px-3 text-float-icon shadow-pop backdrop-blur-[7px] transition-[background-color,color,scale] duration-(--dur-fast) before:absolute before:-inset-[9px] before:content-[''] hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97]"
      style={{ bottom, height: DOTS_ROW_H, gap: DOTS_GAP }}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          aria-hidden
          data-dot-active={i === index || undefined}
          className={`block h-1.5 rounded-full transition-[width,background-color] duration-(--dur-fast) ${
            i === index ? 'w-4 bg-txt' : 'w-1.5 bg-dim'
          }`}
        />
      ))}
    </button>
  )
}
