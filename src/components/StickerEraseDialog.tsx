import type { Photo } from '../lib/imageStore'
import type { MaskEditorHandle } from '@/components/StickerMaskEditor'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useRef, useState } from 'react'
import { StickerMaskEditor } from '@/components/StickerMaskEditor'
import { useT } from '../lib/i18n'
import { eraseStickerAsset } from '../lib/stickerAssets'
import { say } from '../lib/toast'
import { scrollFadeStyle, useScrollFade } from '../lib/useScrollFade'
import { Button } from './ui/button'
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
 *
 * Layout: the editor's own content scrolls (with the app's scroll-edge fade, so
 * the cut is visible as a cue) while **Cancel / Apply sit in a fixed footer
 * outside it**, so a short window (a landscape phone is 412px tall) can never
 * put the commit below the fold. The editor passes `actions="none"` for that: it
 * stays one component, the pair is just drawn by the host.
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
  /** The layers are decodable: the pinned Apply becomes live. */
  const [ready, setReady] = useState(false)
  const editorRef = useRef<MaskEditorHandle | null>(null)
  const scrollRef = useScrollFade<HTMLDivElement>('y')
  const markReady = useCallback(() => setReady(true), [])

  const commit = async (dataUrl: string) => {
    setBusy(true)
    try {
      await eraseStickerAsset(photo, dataUrl, t)
      onDone()
    }
    catch {
      say(t('Failed to save sticker'))
      // Only a failure needs the flag cleared: a commit that landed closes the
      // dialog (this surface unmounts), and clearing it first would put a live
      // Apply back on screen for the length of the close.
      // react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- the success path unmounts
      setBusy(false)
    }
  }

  return (
    <>
      {/* One child, so the fade hook measures the content rather than the note. */}
      <div
        ref={scrollRef}
        style={scrollFadeStyle}
        data-sticker-erase-scroll=""
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <div className="flex flex-col gap-2.5">
          {/* Two lines when there is room; on a short window it holds one, so the
              toolbar below it still starts on screen (the title carries the rest). */}
          <p
            className="m-0 text-[11.5px] leading-[1.5] text-dim [@media(max-height:640px)]:line-clamp-1"
            title={t('Paint the sticker’s own edge. Applying it saves a new sticker in the same folder · the copies already placed keep the old pixels.')}
            data-sticker-erase-note=""
          >
            {t('Paint the sticker’s own edge. Applying it saves a new sticker in the same folder · the copies already placed keep the old pixels.')}
          </p>
          {busy
            ? <span className="grid h-[min(34dvh,280px)] place-items-center text-[11.5px] text-faint [@media(max-height:560px)]:h-[min(26dvh,280px)]">{t('Saving...')}</span>
            : (
                <StickerMaskEditor
                  ref={editorRef}
                  src={src}
                  actions="none"
                  onReady={markReady}
                  onApply={dataUrl => void commit(dataUrl)}
                  onCancel={onDone}
                />
              )}
        </div>
      </div>

      {/* The commit never scrolls: a 412px-tall window shows it pinned. */}
      <div className="flex flex-none justify-end gap-[6px] border-t border-line px-3 py-2.5">
        <Button onClick={onDone}>{t('Cancel')}</Button>
        <Button
          variant="strong"
          disabled={!ready || busy}
          onClick={() => editorRef.current?.apply()}
          data-sticker-erase-apply=""
        >
          {t('Apply')}
        </Button>
      </div>
    </>
  )
}
