/**
 * The koma mark at UI size: the 16px small cut (16 margin, 28 gutters), cropped
 * to its 224-unit mark box so the top bar can set its height without transparent
 * padding. The wider small-cut gutters are what keep the three panes apart when
 * the bar renders at 1×; the primary 24-gutter mark is for 24px and up.
 * currentColor lets one asset serve ink-on-paper and paper-on-ink.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="16 16 224 224" aria-hidden="true" focusable="false" className={className}>
      <path fill="currentColor" d="M16 16H240V122H16Z M16 150H130V240H16Z M158 150H240V240H158Z" />
    </svg>
  )
}
