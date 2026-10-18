import type { Workspace } from '../store'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { ArrowLeft, Redo2, RotateCcw, Undo2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { canRedo, canUndo } from '../lib/history'
import { useT } from '../lib/i18n'
import { isGridPath, OVERVIEW_PATH } from '../lib/routes'
import { say } from '../lib/toast'
import { viewTransitionOption } from '../lib/viewTransition'
import { useStore } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { Tip } from './ui/tip'

// The floating-chrome idiom shared with the pane buttons and the resize
// handle: float-bg + blur, chip-hover on hover.
const btnCls = 'pointer-events-auto grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg text-float-icon backdrop-blur-[7px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35 pointer-coarse:h-[38px] pointer-coarse:w-[38px]'

/**
 * Floating page chrome just under the top bar: back-to-grid on the left
 * (edit view only) and, on the right, undo / redo of the board (both views:
 * the history is app-global) ahead of reset-workspace (the active workspace in
 * the editor, all nine from the grid overview). Undo / redo walk the step tree
 * one step at a time; the whole tree is the History panel in the workspace
 * menu, which can jump to any step of any branch. Floating keeps the top bar to
 * menus and export; the buttons hover over the stage / grid instead of taking
 * layout space, and sit below the drawers (z-44) so an open drawer covers
 * them. Below lg the focused pane's split lives in the tools dock (Stage).
 */
export function FloatActions() {
  const navigate = useNavigate()
  const grid = useRouterState({ select: s => isGridPath(s.location.pathname) })
  const t = useT()
  const [resetAsk, setResetAsk] = useState(false)
  const undoable = useStore(s => canUndo(s.history))
  const redoable = useStore(s => canRedo(s.history))

  // 1-based grid position of the active workspace: it names the reset target
  // in the confirm (the grid itself carries no active-cell marker).
  const pos = useStore(s => s.workspaces.findIndex(w => w.id === s.activeId) + 1)
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
    void navigate({ to: OVERVIEW_PATH, viewTransition: viewTransitionOption() })
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

      {/* Right cluster: undo / redo of the board, then reset last at the corner. */}
      <div className="pointer-events-none absolute right-2.5 top-2.5 flex gap-1.5">
        <Tip
          label={t('Undo · ⌘Z')}
          trigger={(
            <button
              className={btnCls}
              aria-label={t('Undo')}
              disabled={!undoable}
              onClick={() => useStore.getState().undo()}
            >
              <MorphIcon icon={Undo2} size={15} strokeWidth={1.75} />
            </button>
          )}
        />

        <Tip
          label={t('Redo · ⌘⇧Z')}
          trigger={(
            <button
              className={btnCls}
              aria-label={t('Redo')}
              disabled={!redoable}
              onClick={() => useStore.getState().redo()}
            >
              <MorphIcon icon={Redo2} size={15} strokeWidth={1.75} />
            </button>
          )}
        />

        <Tip
          label={grid ? t('Reset all workspaces') : t('Reset this workspace')}
          trigger={(
            <button
              className={btnCls}
              aria-label={grid ? t('Reset all workspaces') : t('Reset this workspace')}
              disabled={!resettable}
              onClick={() => setResetAsk(true)}
            >
              <MorphIcon icon={RotateCcw} size={15} strokeWidth={1.75} />
            </button>
          )}
        />
      </div>

      <ConfirmDialog
        open={resetAsk}
        title={grid ? t('Reset all workspaces?') : t('Reset this workspace?')}
        description={grid
          ? t('This clears the pane layout and photo placement of all workspaces. Photos stay in the library.')
          : t('This clears the pane layout and photo placement of space {n}. Photos stay in the library.', { n: pos })}
        confirmLabel={grid ? t('Reset all') : t('Reset')}
        danger
        onClose={() => setResetAsk(false)}
        onConfirm={doReset}
      />
    </div>
  )
}
