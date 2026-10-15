import type { Workspace } from '../store'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { ArrowLeft, RotateCcw } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { useT } from '../lib/i18n'
import { say } from '../lib/toast'
import { viewTransitionOption } from '../lib/viewTransition'
import { activeWs, useStore } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { PaneSplitTools } from './Pane'
import { Tip } from './ui/tip'

// The floating-chrome idiom shared with the pane buttons and the resize
// handle: float-bg + blur, chip-hover on hover.
const btnCls = 'pointer-events-auto grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg text-float-icon backdrop-blur-[7px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35 pointer-coarse:h-[38px] pointer-coarse:w-[38px]'

/**
 * Floating page chrome just under the top bar: back-to-grid on the left
 * (edit view only), the focused pane's split chip in the center, and
 * reset-workspace on the right (both views: the active workspace in the
 * editor, all nine from the grid overview). Floating keeps the top bar to
 * menus and export; the buttons hover over the stage / grid instead of taking
 * layout space, and sit below the drawers (z-44) so an open drawer covers
 * them. The split chip acts on the focused pane and only shows up to lg: from
 * there the panes' own hover chips take over, and on a phone it is the only
 * split there is.
 */
export function FloatActions() {
  const navigate = useNavigate()
  const grid = useRouterState({ select: s => s.location.pathname === '/' })
  const t = useT()
  const [resetAsk, setResetAsk] = useState(false)

  // 1-based grid position of the active workspace: it names the reset target
  // in the confirm (the grid itself carries no active-cell marker).
  const pos = useStore(s => s.workspaces.findIndex(w => w.id === s.activeId) + 1)
  // The center of this row is the focused pane's split chip; with no focus in
  // the editor the page row is just back and reset. It is looked up in the
  // store rather than handed down by the stage, which floats in the same box.
  const focusId = useStore(s => activeWs(s).focusId)
  const split = useStore(s => s.split)
  // Nothing to reset while every target is still a fresh blank canvas: the
  // active workspace in the editor, all nine in the grid overview.
  const resettable = useStore((s) => {
    const dirty = (w: Workspace) => {
      const r = w.root
      return r.type !== 'leaf' || r.photoId != null || r.label != null
        || (w.stickers?.length ?? 0) > 0 || (w.labels?.length ?? 0) > 0
        || w.canvasRatio != null || w.canvasFill !== 1
    }
    return (grid ? s.workspaces : s.workspaces.filter(w => w.id === s.activeId)).some(dirty)
  })

  const goGrid = () => {
    useStore.getState().clearSelection()
    void navigate({ to: '/', viewTransition: viewTransitionOption() })
  }

  const doReset = () => {
    const s = useStore.getState()
    if (grid)
      s.resetAllWorkspaces()
    else
      s.resetWorkspace(s.activeId)
    setResetAsk(false)
    say(grid ? t('All workspaces reset') : t('Workspace reset'))
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {!grid && (
        <Tip
          label={t('Back to the grid · G')}
          trigger={(
            <button
              className={`${btnCls} absolute left-2.5 top-2.5`}
              aria-label={t('Back to the grid')}
              onClick={goGrid}
            >
              <MorphIcon icon={ArrowLeft} size={15} strokeWidth={1.75} />
            </button>
          )}
        />
      )}

      {/* The focused pane's split chip, centered between back and reset, and
          dropped from lg up, where the panes' own hover chips take over. It is
          the only copy a phone gets: the hover one is hidden below sm. */}
      {!grid && focusId && (
        <PaneSplitTools
          paneId={focusId}
          onSplit={split}
          className="pointer-events-auto absolute left-1/2 top-2.5 -translate-x-1/2 lg:hidden"
        />
      )}

      <Tip
        label={grid ? t('Reset all workspaces') : t('Reset this workspace')}
        trigger={(
          <button
            className={`${btnCls} absolute right-2.5 top-2.5`}
            aria-label={grid ? t('Reset all workspaces') : t('Reset this workspace')}
            disabled={!resettable}
            onClick={() => setResetAsk(true)}
          >
            <MorphIcon icon={RotateCcw} size={15} strokeWidth={1.75} />
          </button>
        )}
      />

      <ConfirmDialog
        open={resetAsk}
        title={grid ? t('Reset all workspaces?') : t('Reset this workspace?')}
        description={grid
          ? t('This clears the pane layout and photo placement of all 9 workspaces. Photos stay in the library. This cannot be undone.')
          : t('This clears the pane layout and photo placement of space {n}. Photos stay in the library. This cannot be undone.', { n: pos })}
        confirmLabel={grid ? t('Reset all') : t('Reset')}
        danger
        onClose={() => setResetAsk(false)}
        onConfirm={doReset}
      />
    </div>
  )
}
