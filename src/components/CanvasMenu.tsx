import type { ReactElement } from 'react'
import { ContextMenu } from '@base-ui/react/context-menu'
import { CircleHelp, Download, FileText, FolderPlus, Grid2x2Plus, ImagePlus, LayoutGrid, Ratio, RotateCcw, RotateCw, Settings } from 'lucide'
import { useRef, useState } from 'react'
import { useAppCommands } from '../lib/appCommands'
import { pickImageFiles, pickImageFolder } from '../lib/filePicker'
import { useT } from '../lib/i18n'
import { leafList } from '../lib/panes'
import { say } from '../lib/toast'
import { activeWs, useStore } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { MenuGroup, MenuItem, menuPopupCls, MenuSeparator, useMenuEscapeClose } from './ui/menu'

/**
 * The workspace menu on the stage's empty space: right-click the checkerboard
 * around the canvas (or a gap between panes) for the actions that belong to
 * the page rather than one pane, the same ones the top bar and the tools panel
 * carry, gathered where the pointer already is. Panes keep their own menu (see
 * Pane.tsx): right-clicking one of those never reaches this trigger.
 */
export function CanvasMenu({ children }: { children: ReactElement }) {
  const t = useT()
  const cmd = useAppCommands()
  const [resetAsk, setResetAsk] = useState(false)
  // Escape closes the menu without reaching the app's global handler (which
  // would leave the editor): see useMenuEscapeClose.
  const actionsRef = useRef<ContextMenu.Root.Actions>(null)
  const [open, setOpen] = useState(false)
  useMenuEscapeClose(open, () => actionsRef.current?.close())

  const photos = useStore(s => s.photos)
  const emptyCount = useStore(s => leafList(activeWs(s).root).filter(l => !l.photoId).length)
  const canvasRatio = useStore(s => activeWs(s).canvasRatio)
  const activeId = useStore(s => s.activeId)
  // 1-based grid position of the active workspace, to name the reset target.
  const pos = useStore(s => s.workspaces.findIndex(w => w.id === s.activeId) + 1)
  const autoFill = useStore(s => s.autoFill)

  // Import through the pickers, then fill the empty panes like a window drop does.
  const addFiles = (files: File[]) => {
    const created = useStore.getState().addPhotos(files)
    say(created.length ? t('Added {n} photos', { n: created.length }) : t('No image files found'))
  }

  const matchFirstPhoto = () => {
    const s = useStore.getState()
    const first = s.photos.find(p => p.trueW > 0)
    if (first)
      s.setCanvasSize(first.trueW / first.trueH, activeWs(s).canvasFill)
  }

  const flipCanvas = () => {
    const s = useStore.getState()
    const ratio = activeWs(s).canvasRatio
    if (ratio)
      s.setCanvasSize(1 / ratio, activeWs(s).canvasFill)
  }

  const doReset = () => {
    useStore.getState().resetWorkspace(activeId)
    setResetAsk(false)
    say(t('Workspace reset'))
  }

  return (
    <>
      <ContextMenu.Root actionsRef={actionsRef} onOpenChange={setOpen}>
        <ContextMenu.Trigger render={children} />
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-90">
            <ContextMenu.Popup className={menuPopupCls}>
              <MenuGroup>
                <MenuItem icon={ImagePlus} onClick={() => pickImageFiles(addFiles)}>
                  {t('Add photos…')}
                </MenuItem>
                <MenuItem icon={FolderPlus} onClick={() => pickImageFolder(addFiles)}>
                  {t('Add folder…')}
                </MenuItem>
                <MenuItem icon={LayoutGrid} hint="I" onClick={() => cmd.setLibraryOpen(v => !v)}>
                  {t('Library')}
                </MenuItem>
              </MenuGroup>

              <MenuSeparator />

              <MenuGroup>
                <MenuItem
                  icon={Grid2x2Plus}
                  disabled={!photos.length || !emptyCount}
                  onClick={() => autoFill()}
                >
                  {t('Fill empty panes ({n})', { n: emptyCount })}
                </MenuItem>
                <MenuItem
                  icon={Ratio}
                  disabled={!photos.some(p => p.trueW > 0)}
                  onClick={matchFirstPhoto}
                >
                  {t('Match the canvas to the first photo')}
                </MenuItem>
                <MenuItem icon={RotateCw} disabled={canvasRatio == null} onClick={flipCanvas}>
                  {t('Flip canvas orientation')}
                </MenuItem>
              </MenuGroup>

              <MenuSeparator />

              <MenuGroup>
                <MenuItem icon={Download} hint="⌘E" disabled={cmd.busy} onClick={cmd.exportNow}>
                  {t('Export image')}
                </MenuItem>
                <MenuItem icon={FileText} hint="C" onClick={cmd.showCrops}>
                  {t('Crop report')}
                </MenuItem>
              </MenuGroup>

              <MenuSeparator />

              <MenuGroup>
                <MenuItem icon={RotateCcw} onClick={() => setResetAsk(true)}>
                  {t('Reset this workspace…')}
                </MenuItem>
                <MenuItem icon={Settings} hint="," onClick={() => cmd.setSettingsOpen(v => !v)}>
                  {t('Settings')}
                </MenuItem>
                <MenuItem icon={CircleHelp} hint="?" onClick={() => cmd.setHelpOpen(v => !v)}>
                  {t('Keyboard shortcuts')}
                </MenuItem>
              </MenuGroup>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <ConfirmDialog
        open={resetAsk}
        title={t('Reset this workspace?')}
        description={t('This clears the pane layout and photo placement of space {n}. Photos stay in the library. This cannot be undone.', { n: pos })}
        confirmLabel={t('Reset')}
        danger
        onClose={() => setResetAsk(false)}
        onConfirm={doReset}
      />
    </>
  )
}
