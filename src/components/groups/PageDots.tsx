import type { PageLayout } from '../../lib/groupPage'
import { useT } from '../../lib/i18n'

export interface PageDotsProps {
  count: number
  active: number
  target: number
  layout: PageLayout
  names: readonly string[]
  onPick: (index: number) => void
}

/**
 * The page dots: one tap target per group. The target grows into an accent pill
 * while a drag leans that way; the open group is a filled dot otherwise.
 */
export function PageDots({ count, active, target, layout, names, onPick }: PageDotsProps) {
  const t = useT()
  const tight = layout.band === 'tight'
  return (
    <div
      data-page-dots=""
      className={`pointer-events-none absolute z-20 flex items-center ${tight ? '' : 'justify-center'}`}
      style={tight
        ? { top: layout.dots.y, left: 16, height: layout.dots.row }
        : { top: layout.dots.y, left: 0, right: 0, height: layout.dots.row }}
    >
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          data-page-dot=""
          className="pointer-events-auto grid cursor-pointer place-items-center border-0 bg-transparent p-0 outline-0 focus-visible:outline-1 focus-visible:outline-accent"
          style={{ width: layout.dots.slot, height: layout.dots.row }}
          aria-label={t('Open group {name}', { name: names[i] ?? '' })}
          aria-current={i === active ? 'page' : undefined}
          onClick={() => onPick(i)}
        >
          <span
            aria-hidden
            className={`block rounded-full transition-[width,background-color] duration-(--dur-fast) ${
              i === target ? 'bg-accent' : i === active ? 'bg-txt' : 'bg-line-strong'
            }`}
            style={{ width: i === target ? layout.dots.active : layout.dots.size, height: layout.dots.size }}
          />
        </button>
      ))}
    </div>
  )
}
