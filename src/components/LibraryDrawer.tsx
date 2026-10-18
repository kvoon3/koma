import type { PickMods } from './Library'
import { Drawer } from '@base-ui/react/drawer'
import { LayoutGrid, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { buttonBase, buttonVariants } from '@/components/ui/buttonStyles'
import { useT } from '../lib/i18n'
import { leafList } from '../lib/panes'
import { photoAssetsOf } from '../lib/stickerLibrary'
import { say } from '../lib/toast'
import { activeWs, useStore } from '../store'
import { Library } from './Library'

export function LibraryDrawer({ open, onClose, onRequestClear }: { open: boolean, onClose: () => void, onRequestClear: () => void }) {
  const allPhotos = useStore(s => s.photos)
  // Stickers live on their own page (#/stickers): the library lists photos.
  const photos = useMemo(() => photoAssetsOf(allPhotos), [allPhotos])
  const assign = useStore(s => s.assign)
  const assignMany = useStore(s => s.assignMany)
  const focusId = useStore(s => activeWs(s).focusId)
  const autoFill = useStore(s => s.autoFill)
  const emptyCount = useStore(s => leafList(activeWs(s).root).filter(l => !l.photoId).length)
  const t = useT()

  // Batch selection, session-only: an array-ordered Set so `assignMany` can
  // fill panes in the order the user picked them.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  // Where a shift-click range starts: the last thumbnail the user clicked.
  const anchorRef = useRef<string | null>(null)

  const activeId = useStore((s) => {
    const root = activeWs(s).root
    const walk = (n: typeof root): string | null =>
      n.type === 'leaf'
        ? n.id === activeWs(s).focusId
          ? n.photoId
          : null
        : (walk(n.a) ?? walk(n.b))
    return walk(root)
  })

  const selectedIds = useMemo(
    () => [...selected].filter(id => photos.some(p => p.id === id)),
    [selected, photos],
  )

  const clearSel = useCallback(() => {
    setSelected(new Set())
    anchorRef.current = null
  }, [])

  const onPick = useCallback((id: string, mods: PickMods) => {
    if (!photos.some(p => p.id === id))
      return
    if (mods.range) {
      const order = photos.map(p => p.id)
      const b = order.indexOf(id)
      // `b` is always found (guarded above); the anchor can be gone if the
      // library changed since the last click, in which case the range is just
      // the clicked photo.
      const a = anchorRef.current ? order.indexOf(anchorRef.current) : b
      setSelected(new Set(order.slice(Math.min(a === -1 ? b : a, b), Math.max(a === -1 ? b : a, b) + 1)))
      return
    }
    if (mods.toggle) {
      anchorRef.current = id
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id))
          next.delete(id)
        else
          next.add(id)
        return next
      })
      return
    }
    // Plain click keeps the old behavior: assign the photo, drop the selection.
    clearSel()
    if (focusId)
      assign(focusId, id)
  }, [photos, focusId, assign, clearSel])

  const addSelectedToEmpty = () => {
    if (!emptyCount) {
      say(t('No empty panes in this workspace'))
      return
    }
    assignMany(selectedIds)
    clearSel()
  }

  // The label counts what will actually land, so a selection larger than the
  // empty panes does not promise photos it cannot place.
  const placeableCount = Math.min(selectedIds.length, emptyCount)

  // Esc clears a live selection before the app-wide handler gets it (which
  // would otherwise close the drawer); the capture phase lets us win.
  useEffect(() => {
    if (!open || selectedIds.length === 0)
      return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape')
        return
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
        return
      e.preventDefault()
      e.stopPropagation()
      clearSel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, selectedIds.length, clearSel])

  const hint = photos.length
    ? t('Click a thumbnail to place it in the focused pane, or drag photos straight onto a pane')
    : t('No photos yet. Click "+ Photo / + Folder" or drop files into the window.')

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          clearSel()
          onClose()
        }
      }}
      swipeDirection="down"
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-44 min-h-dvh bg-overlay-dim opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--dur-drawer) ease-(--ease-drawer) data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]" />
        <Drawer.Viewport className="fixed inset-0 z-45 flex items-end justify-center">
          {/* The swipe rewrites the popup's translate every frame with the
              transition off (data-swiping), so the compositor hint rides the
              same state instead of the popup's whole mounted life. */}
          <Drawer.Popup className="relative box-border flex h-[190px] w-[min(920px,100vw)] flex-col overflow-hidden rounded-none border border-b-0 border-line bg-drawer-bg text-txt shadow-pop outline-0 translate-y-[var(--drawer-swipe-movement-y,0px)] transition-transform duration-(--dur-drawer) ease-(--ease-drawer) data-swiping:will-change-transform mb-[env(safe-area-inset-bottom)] pointer-coarse:h-[232px] max-sm:h-[232px] data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:translate-y-[calc(100%+env(safe-area-inset-bottom))] data-ending-style:translate-y-[calc(100%+env(safe-area-inset-bottom))]">
            <Drawer.Content className="flex min-h-0 flex-1 flex-col outline-0">
              <header className="flex flex-none items-center gap-2.5 py-1.5 pl-3.5 pr-2.5">
                <Drawer.Title className="m-0 text-[12.5px] font-bold">{t('Library')}</Drawer.Title>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-dim">{hint}</span>
                <span className="flex-1" />
                <Button onClick={() => autoFill()} disabled={!photos.length}>
                  {t('Fill empty panes')}
                </Button>
                <Button onClick={onRequestClear} disabled={!photos.length}>
                  {t('Clear')}
                </Button>
                <Drawer.Close
                  className={`${buttonBase} ${buttonVariants.close}`}
                  aria-label={t('Hide library · Shortcut: L')}
                >
                  <MorphIcon icon={X} size={15} strokeWidth={1.75} />
                </Drawer.Close>
              </header>
              <div className="relative flex min-h-0 flex-1 flex-col">
                <Library
                  photos={photos}
                  activeId={activeId}
                  selectedIds={selected}
                  layout="row"
                  onPick={onPick}
                />
                {selectedIds.length >= 2 && (
                  <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-none border border-line-strong bg-panel px-1.5 py-1 shadow-pop">
                    <Button variant="on" onClick={addSelectedToEmpty}>
                      <MorphIcon icon={LayoutGrid} size={13} strokeWidth={1.75} />
                      {t('Add {n} to empty panes', { n: placeableCount })}
                    </Button>
                    <Button onClick={clearSel}>
                      {t('Clear')}
                    </Button>
                  </div>
                )}
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
