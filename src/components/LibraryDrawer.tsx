import { Drawer } from '@base-ui/react/drawer'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { findLeaf, leafList } from '../lib/panes'
import { useStore } from '../store'
import { Library } from './Library'
import './drawers.css'

export function LibraryDrawer({ open, onClose }: { open: boolean, onClose: () => void }) {
  const photos = useStore(s => s.photos)
  const assign = useStore(s => s.assign)
  const focusId = useStore(s => s.focusId)
  const root = useStore(s => s.root)
  const clearLibrary = useStore(s => s.clearLibrary)
  const autoFill = useStore(s => s.autoFill)
  const pick = useStore(s => s.stickerPick)
  const addSticker = useStore(s => s.addSticker)
  const cancelStickerPick = useStore(s => s.cancelStickerPick)

  const activeId = useStore((s) => {
    const walk = (n: typeof s.root): string | null =>
      n.type === 'leaf'
        ? n.id === s.focusId
          ? n.photoId
          : null
        : (walk(n.a) ?? walk(n.b))
    return walk(s.root)
  })

  const pickIndex = pick ? leafList(root).findIndex(l => l.id === pick.paneId) + 1 : 0
  const pickReady = pick ? !!findLeaf(root, pick.paneId)?.photoId : false

  const hint = pick
    ? pickReady
      ? `Pick one to use as a sticker · it lands on pane ${pickIndex}; you can add several in a row`
      : 'That pane has no photo yet — stickers are placed on photos'
    : photos.length
      ? 'Click a thumbnail to place it in the focused pane, or drag photos straight onto a pane'
      : 'No photos yet. Click "+ Photo / + Folder" or drop files into the window.'

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
      swipeDirection="down"
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="bui-drawer-backdrop" />
        <Drawer.Viewport className="bui-drawer-viewport">
          <Drawer.Popup className="bui-drawer-popup bui-drawer-popup-lib">
            <Drawer.Content className="bui-drawer-content">
              <header className="bui-drawer-head">
                <Drawer.Title className="bui-drawer-title">Library</Drawer.Title>
                <span className="bui-drawer-hint">{hint}</span>
                <span className="bui-drawer-spacer" />
                {pick && (
                  <button
                    className="flat on"
                    onClick={cancelStickerPick}
                    title="Shortcut: Esc"
                  >
                    Done placing
                  </button>
                )}
                <button className="flat" onClick={() => autoFill()} disabled={!photos.length}>
                  Fill empty panes
                </button>
                <button className="flat" onClick={clearLibrary} disabled={!photos.length}>
                  Clear
                </button>
                <Drawer.Close
                  className="flat bui-drawer-close"
                  onClick={cancelStickerPick}
                  aria-label="Hide library · Shortcut: L"
                >
                  <MorphIcon icon={X} size={15} strokeWidth={1.75} />
                </Drawer.Close>
              </header>
              <Library
                photos={photos}
                activeId={pick ? null : activeId}
                layout="row"
                onPick={(id) => {
                  if (pick) {
                    addSticker(pick.paneId, id)
                  }
                  else if (focusId) {
                    assign(focusId, id)
                  }
                }}
              />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
