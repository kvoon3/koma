import type { Photo } from '../lib/imageStore'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { StickerMaskEditor } from '@/components/StickerMaskEditor'
import { useT } from '../lib/i18n'
import { eraseStickerAsset } from '../lib/stickerAssets'
import { say } from '../lib/toast'
import { buttonBase, buttonVariants } from './ui/buttonStyles'

/**
 * **Erase**: paint a saved sticker's silhouette directly. The asset is the
 * composited PNG (cutout, border and perforation baked in), so its own alpha is
 * the shape to paint over: the same brush, lasso, zoom and undo the maker's
 * Adjust cutout uses, on the same `StickerMaskEditor`, with the commit being
 * source α × mask α (see lib/stickerMask).
 *
 * It works on every sticker, including the ones made before re-editing existed,
 * because nothing here needs the maker's inputs, only the record's pixels. The
 * result is a NEW record beside it in the same folder (see `eraseStickerAsset`),
 * which is what keeps the snapshot principle: the copies already placed keep
 * drawing the old asset, so no board changes and no history entry is pushed.
 *
 * Only the dialog shell is this component's own; the editor, its undo stack and
 * its commit are the maker's.
 *
 * `src` is an object URL the caller mints when the action is clicked and
 * revokes when the dialog closes. Minting it here, in an effect or during
 * render, would race the StrictMode double mount: a URL made during the first
 * pass is revoked by the cleanup of a mount that never showed anything, and
 * the image then fails to load.
 */
export function StickerEraseDialog({ open, photo, src, onClose }: {
  open: boolean
  /** The sticker being painted over; null while closed. */
  photo: Photo | null
  /** The sticker's own PNG, as the URL the mask editor decodes. */
  src: string | null
  onClose: () => void
}) {
  const t = useT()

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed z-(--z-modal) inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup
          data-sticker-erase-dialog=""
          data-sticker-erase-id={photo?.id ?? ''}
          className="fixed z-(--z-modal) left-1/2 top-1/2 flex max-h-[min(86dvh,720px)] w-[min(480px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-none border border-line bg-panel text-txt shadow-pop outline-0 transition-[opacity,translate,scale] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]"
        >
          <header className="flex items-center justify-between gap-2.5 border-b border-line py-[11px] pl-4 pr-3">
            <Dialog.Title className="m-0 truncate text-[13.5px] font-semibold">{t('Erase sticker')}</Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          {/* One mount per opening: the editor starts from that sticker's PNG
              and its undo stack is that opening's own. */}
          {photo && src && <EraseSurface key={photo.id} photo={photo} src={src} onDone={onClose} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * The erase editor over one sticker's PNG. A commit hands the painted PNG to
 * `eraseStickerAsset` (new record, same folder).
 */
function EraseSurface({ photo, src, onDone }: { photo: Photo, src: string, onDone: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)

  const commit = async (dataUrl: string) => {
    setBusy(true)
    try {
      await eraseStickerAsset(photo, dataUrl, t)
      onDone()
    }
    catch {
      say(t('Failed to save sticker'))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
      <p className="m-0 text-[11.5px] leading-[1.5] text-dim" data-sticker-erase-note="">
        {t('Paint the sticker’s own edge. Applying it saves a new sticker in the same folder · the copies already placed keep the old pixels.')}
      </p>
      {busy
        ? <span className="grid h-[min(46dvh,280px)] place-items-center text-[11.5px] text-faint">{t('Saving...')}</span>
        : (
            <StickerMaskEditor
              src={src}
              onApply={dataUrl => void commit(dataUrl)}
              onCancel={onDone}
            />
          )}
    </div>
  )
}
