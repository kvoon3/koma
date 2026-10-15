import type { ReactElement } from 'react'
import type { Photo } from '../lib/imageStore'
import type { Leaf, Rect } from '../lib/panes'
import type { PaneClip } from '../store'
import { ContextMenu } from '@base-ui/react/context-menu'
import { ArrowLeftRight, ClipboardPaste, Copy, CopyPlus, Download, Eraser, Focus, Frame, Image as ImageIcon, ImagePlus, Maximize, Move, Play, Ratio, RotateCcw, Shuffle, Square, SquareSplitHorizontal, SquareSplitVertical, SquareX, Sticker as StickerIcon, Trash2, Type, WandSparkles, X } from 'lucide'
import { useRef, useState } from 'react'
import { downloadBlob } from '../lib/exporter'
import { useT } from '../lib/i18n'
import { addLabelToPane, pickStickersForPane } from '../lib/paneCommands'
import { leafList } from '../lib/panes'
import { activeWs, MIN_ZOOM, useStore } from '../store'
import { MenuGroup, MenuItem, menuPopupCls, MenuSeparator, MenuSubmenu, useMenuEscapeClose } from './ui/menu'

/**
 * The pane's right-click menu. Move leads it, since picking the photo up is
 * the one action that takes over the pointer; then rows are ordered by what
 * they act on: the photo, this pane's own layout, its decoration, the
 * arrangement, then closing it. Every row is a store action or a pick flow
 * scoped to this pane; the gesture code that opens the menu and starts Move
 * stays in Pane.tsx.
 */

/** How the photo sits in the pane, and how to keep a copy of the file. */
function PhotoSubmenu({ leaf, rect, photo, iw, ih, live, onToggleLive }: {
  leaf: Leaf
  rect: Rect
  photo: Photo
  iw: number
  ih: number
  live: boolean
  onToggleLive: () => void
}) {
  const t = useT()
  const updateLeaf = useStore(s => s.updateLeaf)

  // Double-click's action, spelled out: zoom 1 is cover, centered.
  const resetView = () => updateLeaf(leaf.id, { zoom: 1, cx: 0.5, cy: 0.5 })

  // Cover is zoom 1 by construction; contain is its ratio of the two cover
  // scales, floored at the shared zoom floor so extreme ratios stay legible.
  const fitPhoto = () => {
    if (!iw || !ih)
      return
    const cover = Math.max(rect.w / iw, rect.h / ih)
    const contain = Math.min(rect.w / iw, rect.h / ih)
    updateLeaf(leaf.id, { zoom: Math.max(MIN_ZOOM, contain / cover), cx: 0.5, cy: 0.5 })
  }

  const matchCanvas = () => {
    if (!photo.trueW || !photo.trueH)
      return
    const s = useStore.getState()
    s.setCanvasSize(photo.trueW / photo.trueH, activeWs(s).canvasFill)
  }

  return (
    <MenuSubmenu icon={ImageIcon} label={t('Photo')}>
      <MenuItem icon={Maximize} hint="R" onClick={resetView}>
        {t('Reset zoom')}
      </MenuItem>
      <MenuItem icon={Frame} onClick={fitPhoto}>{t('Fit whole photo')}</MenuItem>
      <MenuItem icon={Ratio} disabled={!photo.trueW} onClick={matchCanvas}>
        {t('Match the canvas to this photo')}
      </MenuItem>
      <MenuItem icon={Download} onClick={() => downloadBlob(photo.file, photo.name)}>
        {t('Save photo file…')}
      </MenuItem>
      {!!photo.videoFile && (
        <MenuItem icon={live ? Square : Play} onClick={onToggleLive}>
          {live ? t('Stop Live Photo') : t('Play Live Photo')}
        </MenuItem>
      )}
    </MenuSubmenu>
  )
}

/** Stickers and the text label: everything pinned on top of the photo. */
function DecorateSubmenu({ leaf }: { leaf: Leaf }) {
  const t = useT()
  const removeLabel = useStore(s => s.removeLabel)
  const openStickerMaker = useStore(s => s.openStickerMaker)

  // Removing the stickers one by one re-renders once (one handler, batched).
  const boardStickers = useStore(s => s.workspaces.find(w => w.id === s.activeId)?.stickers ?? [])
  const clearStickers = () => {
    const s = useStore.getState()
    for (const st of boardStickers)
      s.removeSticker(st.id)
  }

  return (
    <MenuSubmenu icon={StickerIcon} label={t('Decorate')}>
      <MenuItem icon={ImagePlus} onClick={() => pickStickersForPane(leaf.id)}>
        {t('Add image sticker…')}
      </MenuItem>
      <MenuItem icon={WandSparkles} onClick={() => openStickerMaker(leaf.id)}>
        {t('Make sticker…')}
      </MenuItem>
      {boardStickers.length > 0 && (
        <MenuItem icon={Eraser} onClick={clearStickers}>
          {t('Clear stickers ({n})', { n: boardStickers.length })}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={Type} onClick={() => addLabelToPane(leaf.id)}>
        {leaf.label ? t('Edit text label') : t('Add text label')}
      </MenuItem>
      {!!leaf.label && (
        <MenuItem icon={X} onClick={() => removeLabel(leaf.id)}>
          {t('Remove text label')}
        </MenuItem>
      )}
    </MenuSubmenu>
  )
}

/** Carrying the pane's contents around: swap, copy / paste, focus. */
function ArrangeSubmenu({
  leaf,
  focused,
  swapTargetId,
  paneClip,
  onFocus,
}: {
  leaf: Leaf
  focused: boolean
  swapTargetId: string | null
  paneClip: PaneClip | null
  onFocus: (id: string) => void
}) {
  const t = useT()
  const swapPhotos = useStore(s => s.swapPhotos)
  const copyPane = useStore(s => s.copyPane)
  const pastePane = useStore(s => s.pastePane)
  const hasPhoto = !!leaf.photoId

  return (
    <MenuSubmenu icon={Shuffle} label={t('Arrange')}>
      {swapTargetId && (
        <MenuItem icon={ArrowLeftRight} onClick={() => swapPhotos(leaf.id, swapTargetId)}>
          {t('Swap with focused pane')}
        </MenuItem>
      )}
      {hasPhoto && (
        <MenuItem icon={Copy} onClick={() => copyPane(leaf.id)}>
          {t('Copy pane')}
        </MenuItem>
      )}
      {paneClip && (
        <MenuItem icon={ClipboardPaste} onClick={() => pastePane(leaf.id)}>
          {t('Paste into this pane')}
        </MenuItem>
      )}
      {!focused && (
        <MenuItem icon={Focus} onClick={() => onFocus(leaf.id)}>
          {t('Focus this pane')}
        </MenuItem>
      )}
    </MenuSubmenu>
  )
}

/**
 * The swap target is the focused pane other than this one; a focused pane
 * itself has nothing to swap with, so the row is gone there.
 */
function swapTargetFor(focused: boolean, focusId: string, leafId: string): string | null {
  return !focused && focusId && focusId !== leafId ? focusId : null
}

/**
 * Move leads the menu: it is the one row that acts on the pane as a whole, so
 * it sits above the photo header instead of inside the Arrange submenu.
 */
function MoveRow({ leaf, onStartMove }: { leaf: Leaf, onStartMove: (x: number, y: number) => void }) {
  const t = useT()
  if (!leaf.photoId)
    return null
  return (
    <>
      <MenuGroup>
        <MenuItem icon={Move} onClick={e => onStartMove(e.clientX, e.clientY)}>
          {t('Move')}
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
    </>
  )
}

/**
 * The header names the photo under the pointer, so the rows below stay
 * unambiguous on a canvas full of panes.
 */
function PhotoHeaderGroup({ leaf, photo, onPickPhoto, onRemovePhoto }: {
  leaf: Leaf
  photo: Photo | null
  onPickPhoto: () => void
  onRemovePhoto: (id: string) => void
}) {
  const t = useT()
  return (
    <MenuGroup variant="title" label={photo?.name ?? t('Empty pane')}>
      <MenuItem icon={ImagePlus} onClick={onPickPhoto}>
        {leaf.photoId ? t('Replace photo…') : t('Choose photo…')}
      </MenuItem>
      {leaf.photoId && (
        <MenuItem icon={Trash2} hint="D" onClick={() => onRemovePhoto(leaf.id)}>
          {t('Remove photo')}
        </MenuItem>
      )}
    </MenuGroup>
  )
}

/** Splitting, duplicating, and resetting: the pane's own layout. */
function LayoutGroup({ leaf, rect, onSplit }: {
  leaf: Leaf
  rect: Rect
  onSplit: (id: string, dir: 'row' | 'column') => void
}) {
  const t = useT()
  const duplicatePane = useStore(s => s.duplicatePane)
  const resetPane = useStore(s => s.resetPane)
  const hasContent = !!leaf.photoId || !!leaf.label
  return (
    <MenuGroup>
      <MenuItem icon={SquareSplitVertical} hint="S" onClick={() => onSplit(leaf.id, 'column')}>
        {t('Split top/bottom')}
      </MenuItem>
      <MenuItem icon={SquareSplitHorizontal} hint="V" onClick={() => onSplit(leaf.id, 'row')}>
        {t('Split left/right')}
      </MenuItem>
      {/* Duplicating toward the longer side keeps both halves usable
          instead of slivering the copy off the short edge. */}
      <MenuItem
        icon={CopyPlus}
        onClick={() => duplicatePane(leaf.id, rect.w >= rect.h ? 'row' : 'column')}
      >
        {t('Duplicate pane')}
      </MenuItem>
      {hasContent && (
        <MenuItem icon={RotateCcw} onClick={() => resetPane(leaf.id)}>
          {t('Reset this pane')}
        </MenuItem>
      )}
    </MenuGroup>
  )
}

/** The photo submenu and its decoration, as one block between separators. */
function PhotoSection({ leaf, rect, photo, iw, ih, live, onToggleLive }: {
  leaf: Leaf
  rect: Rect
  photo: Photo | null
  iw: number
  ih: number
  live: boolean
  onToggleLive: () => void
}) {
  if (!photo)
    return null
  return (
    <>
      <MenuSeparator />
      <PhotoSubmenu
        leaf={leaf}
        rect={rect}
        photo={photo}
        iw={iw}
        ih={ih}
        live={live}
        onToggleLive={onToggleLive}
      />
      <DecorateSubmenu leaf={leaf} />
    </>
  )
}

/** Swap, copy / paste, focus: shown when any of them can act. */
function ArrangeSection({ leaf, focused, swapTargetId, paneClip, onFocus }: {
  leaf: Leaf
  focused: boolean
  swapTargetId: string | null
  paneClip: PaneClip | null
  onFocus: (id: string) => void
}) {
  const canArrange = !!leaf.photoId || !!paneClip || !!swapTargetId || !focused
  if (!canArrange)
    return null
  return (
    <>
      <MenuSeparator />
      <ArrangeSubmenu
        leaf={leaf}
        focused={focused}
        swapTargetId={swapTargetId}
        paneClip={paneClip}
        onFocus={onFocus}
      />
    </>
  )
}

/**
 * Closing rows: the other panes, the empty ones (only when some exist), and
 * this pane. "Close empty panes" must never close the pane it was invoked on,
 * so it stays hidden while this is the only empty one.
 */
function CloseSection({ leaf, canClose, onClose, closeOtherPanes, closeEmptyPanes }: {
  leaf: Leaf
  canClose: boolean
  onClose: (id: string) => void
  closeOtherPanes: (id: string) => void
  closeEmptyPanes: () => void
}) {
  const t = useT()
  const emptyOthers = useStore(s =>
    leafList(activeWs(s).root).filter(l => l.id !== leaf.id && !l.photoId).length)
  if (!canClose)
    return null
  return (
    <>
      <MenuSeparator />
      <MenuGroup>
        <MenuItem icon={SquareX} onClick={() => closeOtherPanes(leaf.id)}>
          {t('Close other panes')}
        </MenuItem>
        {emptyOthers > 0 && (
          <MenuItem icon={X} onClick={() => closeEmptyPanes()}>
            {t('Close empty panes ({n})', { n: emptyOthers })}
          </MenuItem>
        )}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem danger icon={X} hint="X" onClick={() => onClose(leaf.id)}>
        {t('Close pane')}
      </MenuItem>
    </>
  )
}

export function PaneMenu({
  leaf,
  rect,
  photo,
  iw,
  ih,
  live,
  focused,
  canClose,
  paneNode,
  onOpenChange,
  onSplit,
  onClose,
  onFocus,
  onToggleLive,
  onStartMove,
  onPickPhoto,
}: {
  leaf: Leaf
  rect: Rect
  photo: Photo | null
  iw: number
  ih: number
  live: boolean
  focused: boolean
  canClose: boolean
  paneNode: ReactElement
  onOpenChange: (open: boolean, details: ContextMenu.Root.ChangeEventDetails) => void
  onSplit: (id: string, dir: 'row' | 'column') => void
  onClose: (id: string) => void
  onFocus: (id: string) => void
  onToggleLive: () => void
  onStartMove: (x: number, y: number) => void
  onPickPhoto: () => void
}) {
  // Escape is ours to handle: Base UI only runs its own Escape handling while
  // the popup holds focus, and a pointer-opened menu leaves focus on the body
  // (see useMenuEscapeClose).
  const actionsRef = useRef<ContextMenu.Root.Actions>(null)
  const [open, setOpen] = useState(false)
  useMenuEscapeClose(open, () => actionsRef.current?.close())
  // The swap item targets the focused pane, so it only makes sense on an
  // unfocused pane: right-clicking the focused one has nothing to swap with.
  const focusId = useStore(s => activeWs(s).focusId)
  const swapTargetId = swapTargetFor(focused, focusId, leaf.id)
  const paneClip = useStore(s => s.paneClip)
  const removePhoto = useStore(s => s.removePhoto)
  const closeOtherPanes = useStore(s => s.closeOtherPanes)
  const closeEmptyPanes = useStore(s => s.closeEmptyPanes)

  return (
    <ContextMenu.Root
      actionsRef={actionsRef}
      onOpenChange={(next, details) => {
        setOpen(next)
        onOpenChange(next, details)
      }}
    >
      <ContextMenu.Trigger render={paneNode} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-90">
          <ContextMenu.Popup className={menuPopupCls}>
            <MoveRow leaf={leaf} onStartMove={onStartMove} />

            <PhotoHeaderGroup
              leaf={leaf}
              photo={photo}
              onPickPhoto={onPickPhoto}
              onRemovePhoto={removePhoto}
            />

            <MenuSeparator />

            <LayoutGroup leaf={leaf} rect={rect} onSplit={onSplit} />

            <PhotoSection
              leaf={leaf}
              rect={rect}
              photo={photo}
              iw={iw}
              ih={ih}
              live={live}
              onToggleLive={onToggleLive}
            />

            <ArrangeSection
              leaf={leaf}
              focused={focused}
              swapTargetId={swapTargetId}
              paneClip={paneClip}
              onFocus={onFocus}
            />

            <CloseSection
              leaf={leaf}
              canClose={canClose}
              onClose={onClose}
              closeOtherPanes={closeOtherPanes}
              closeEmptyPanes={closeEmptyPanes}
            />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
