/**
 * The overview's caption row: the two chips that act on the whole board, the
 * workspace switcher's door and the snapshot render. Groups render nameless, so
 * there is nothing to name on the left: the pair sits centred over the board.
 */
import { Camera, LayoutGrid, LoaderCircle } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useT } from '../../lib/i18n'
import { Tip } from '../ui/tip'

/** The floating-chip idiom shared with FloatActions (back / reset). The chips'
 * square edge is also the `btn` `grid/switcherLayout` measures this row by to
 * seat it under the floating action cluster on a phone. */
const snapBtnCls = 'grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg text-float-icon backdrop-blur-[7px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35 pointer-coarse:h-[38px] pointer-coarse:w-[38px]'

export function BoardCaption({ width, height, snapshotDisabled, snapshotBusy, onOpenSwitcher, onSnapshot }: {
  /** The board's width and the row's own height (the board column's). */
  width: number
  height: number
  /** Nothing to snapshot (an all-empty board), or another export is running. */
  snapshotDisabled: boolean
  /** The snapshot render the chip itself started is still running. */
  snapshotBusy: boolean
  onOpenSwitcher: () => void
  onSnapshot: () => void
}) {
  const t = useT()
  return (
    <div
      data-board-caption=""
      className="flex items-center justify-center gap-1.5"
      style={{ width, height }}
    >
      <Tip
        label={t('Workspace')}
        trigger={(
          <button
            className={snapBtnCls}
            aria-label={t('Workspace')}
            onClick={onOpenSwitcher}
          >
            <MorphIcon icon={LayoutGrid} size={15} strokeWidth={1.75} />
          </button>
        )}
      />
      <Tip
        label={t('Snapshot: each cell plus the whole grid')}
        trigger={(
          <button
            className={snapBtnCls}
            aria-label={t('Snapshot: each cell plus the whole grid')}
            disabled={snapshotDisabled}
            onClick={onSnapshot}
          >
            <MorphIcon
              icon={snapshotBusy ? LoaderCircle : Camera}
              size={15}
              strokeWidth={1.75}
              className={snapshotBusy ? 'animate-spin [animation-duration:900ms]' : undefined}
            />
          </button>
        )}
      />
    </div>
  )
}
