import { Drawer } from '@base-ui/react/drawer'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { Button, buttonBase, buttonVariants } from '@/components/ui/button'
import { useT } from '../lib/i18n'
import { activeWs, useStore } from '../store'
import { Library } from './Library'

export function LibraryDrawer({ open, onClose, onRequestClear }: { open: boolean, onClose: () => void, onRequestClear: () => void }) {
  const photos = useStore(s => s.photos)
  const assign = useStore(s => s.assign)
  const focusId = useStore(s => activeWs(s).focusId)
  const autoFill = useStore(s => s.autoFill)
  const t = useT()

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

  const hint = photos.length
    ? t('Click a thumbnail to place it in the focused pane, or drag photos straight onto a pane')
    : t('No photos yet. Click "+ Photo / + Folder" or drop files into the window.')

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
        <Drawer.Backdrop className="fixed inset-0 z-44 min-h-dvh bg-overlay-dim opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]" />
        <Drawer.Viewport className="fixed inset-0 z-45 flex items-end justify-center">
          <Drawer.Popup className="relative box-border flex h-[190px] w-[min(920px,100vw)] flex-col overflow-hidden rounded-none border border-b-0 border-line bg-drawer-bg text-txt shadow-pop outline-0 translate-y-[var(--drawer-swipe-movement-y,0px)] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform mb-[calc(var(--statusH)+env(safe-area-inset-bottom))] pointer-coarse:h-[232px] max-sm:h-[232px] data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:translate-y-[calc(100%+var(--statusH))] data-ending-style:translate-y-[calc(100%+var(--statusH))]">
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
              <Library
                photos={photos}
                activeId={activeId}
                layout="row"
                onPick={(id) => {
                  if (focusId)
                    assign(focusId, id)
                }}
              />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
