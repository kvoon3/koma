import { findLeaf, leafList } from '../lib/panes'
import { useStore } from '../store'
import { Library } from './Library'

export function LibraryDrawer({ onClose }: { onClose: () => void }) {
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
    <div className="drawer">
      <header>
        <strong>Library</strong>
        <span className="hint dim">{hint}</span>
        <span className="spacer" />
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
        <button
          className="flat"
          onClick={() => {
            cancelStickerPick()
            onClose()
          }}
          title="Shortcut: L"
        >
          Hide
        </button>
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
    </div>
  )
}
