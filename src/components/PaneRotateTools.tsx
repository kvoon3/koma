import { Popover } from '@base-ui/react/popover'
import { FlipHorizontal2, FlipVertical2, Gauge, RotateCcwSquare, RotateCwSquare } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { degToRad, radToDeg, wrapDeg } from '../lib/detent'
import { useT } from '../lib/i18n'
import { findLeaf, rotationOf } from '../lib/panes'
import { activeWs, useStore } from '../store'
import { toolsBtnCls, toolsLabelCls } from './ToolsDock'
import { dockBtnStateCls, dockPopupMotionCls, menuSurfaceCls } from './ui/menu'
import { RotationControl } from './ui/RotationControl'

/**
 * The drawer's rotation tool: one button in the pane tools that opens the shared
 * detent dial plus the flip pair and the ±90° quarter turns. It exists only
 * while a pane with a photo is focused, like the rest of the pane tools, and it
 * is a sibling of them rather than a member of their list so the dock's order is
 * untouched (`Stage.tsx` renders it once, see `<PaneRotateTool />`).
 */

const chipCls = 'flex h-8 cursor-pointer items-center justify-center gap-1 rounded-none border border-line-strong bg-panel-2 text-[11px] text-dim hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97] aria-pressed:border-accent aria-pressed:text-accent disabled:cursor-default disabled:opacity-35'

/** The focused pane, or null (no focus, or the grid route's empty id). */
function focusedLeaf(s: Parameters<typeof activeWs>[0]) {
  const ws = activeWs(s)
  return findLeaf(ws.root, ws.focusId)
}

export function PaneRotateTool({ hidden = false }: { hidden?: boolean }) {
  const t = useT()
  const paneId = useStore(s => activeWs(s).focusId)
  // Primitives only: panning streams leaf updates, and a tool that re-rendered
  // every frame to read two booleans would be waste.
  const photoId = useStore(s => focusedLeaf(s)?.photoId ?? null)
  const flipX = useStore(s => !!focusedLeaf(s)?.flipX)
  const flipY = useStore(s => !!focusedLeaf(s)?.flipY)
  const deg = useStore(s => wrapDeg(radToDeg(rotationOf(focusedLeaf(s) ?? {}))))
  const rotatePane = useStore(s => s.rotatePane)
  const flipPane = useStore(s => s.flipPane)
  const resetPaneRotation = useStore(s => s.resetPaneRotation)

  // Same rule as the pane tools: no focused pane holding a photo, no tool.
  if (hidden || !photoId)
    return null
  const flipped = { x: flipX, y: flipY }

  const rotateBy = (delta: number) => rotatePane(paneId, degToRad(deg + delta))

  return (
    <Popover.Root>
      <Popover.Trigger
        className={`${toolsBtnCls} ${dockBtnStateCls}`}
        title={t('Rotate or flip this photo')}
        aria-label={t('Rotate or flip this photo')}
        data-dock-tool={t('Rotate')}
      >
        {/*
         * `Gauge`, not a circular arrow: next to Reset (`RotateCcw`) two
         * mirrored arrows read as one glyph. An arch and a needle say "dial"
         * (this popover is the detent dial) and share no ring or arrowhead
         * with Reset, so the pair tells apart at 22px.
         */}
        <MorphIcon icon={Gauge} size={22} strokeWidth={1.5} />
        <span className={toolsLabelCls}>{t('Rotate')}</span>
      </Popover.Trigger>
      <Popover.Portal>
        {/*
         * `sticky`: this trigger ends the dock's single-row scroller, and opening
         * the popover re-measures the drawer (a hidden pass that collapses the
         * row), clamping that row's scroll to 0. The anchor then lands past the
         * viewport edge, so the popup needs to be shifted back into view.
         */}
        <Popover.Positioner side="top" align="center" sideOffset={6} collisionPadding={8} sticky className="z-[260] select-none outline-0">
          <Popover.Popup className={`${menuSurfaceCls} ${dockPopupMotionCls} w-[272px] p-2 text-txt`}>
            <RotationControl
              label={t('Rotation')}
              value={degToRad(deg)}
              onChange={rad => rotatePane(paneId, rad)}
            />
            <div className="mt-2 grid grid-cols-4 gap-1">
              <button
                type="button"
                className={chipCls}
                title={t('Rotate left 90°')}
                aria-label={t('Rotate left 90°')}
                onClick={() => rotateBy(-90)}
              >
                <MorphIcon icon={RotateCcwSquare} size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className={chipCls}
                title={t('Rotate right 90°')}
                aria-label={t('Rotate right 90°')}
                onClick={() => rotateBy(90)}
              >
                <MorphIcon icon={RotateCwSquare} size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className={chipCls}
                title={t('Flip horizontally')}
                aria-label={t('Flip horizontally')}
                aria-pressed={flipped.x}
                onClick={() => flipPane(paneId, 'x')}
              >
                <MorphIcon icon={FlipHorizontal2} size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className={chipCls}
                title={t('Flip vertically')}
                aria-label={t('Flip vertically')}
                aria-pressed={flipped.y}
                onClick={() => flipPane(paneId, 'y')}
              >
                <MorphIcon icon={FlipVertical2} size={15} strokeWidth={1.75} />
              </button>
            </div>
            <div className="mt-1 grid grid-cols-1">
              <button
                type="button"
                className={chipCls}
                title={t('Reset rotation')}
                disabled={deg === 0 && !flipped.x && !flipped.y}
                onClick={() => resetPaneRotation(paneId)}
              >
                {t('Reset rotation')}
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
