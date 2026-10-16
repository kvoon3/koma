import { Dialog } from '@base-ui/react/dialog'
import { Copy, Download, LoaderCircle, Play, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { useMediaQuery } from '../hooks'
import { isWeChat } from '../lib/browser'
import { canCopyImage, copyImageToClipboard, downloadBlob } from '../lib/exporter'
import { useT } from '../lib/i18n'
import { say } from '../lib/toast'
import { buttonBase, buttonVariants, dialogButton } from './ui/buttonStyles'

/**
 * One rendered export run: a batch is the still of every non-empty workspace
 * (and, when a pane holds a Live Photo, the paired video right after its
 * still), a single export is the one still. The run owns its object URLs (the
 * caller releases them, see `onReleased`) rather than this dialog, so a
 * remount can never blank a preview that is still on screen.
 */
export interface ExportItem {
  kind: 'image' | 'video'
  blob: Blob
  /** Object URL for the preview and (via the blob) the download anchor. */
  url: string
  /** File name the download buttons save as, extension included. */
  name: string
  /** Pixel size, for the caption. */
  w: number
  h: number
  /** Set on a batch: the 1-based grid position of the workspace it came from. */
  group?: number
  /** A video recorded from the still before it (a Live Photo's motion). */
  live?: boolean
}

/** The shape of `t`, for the module-level helpers that only need to translate. */
type Translate = ReturnType<typeof useT>

/**
 * `image/jpeg` → `JPEG`, `video/mp4;codecs=avc1.42E01E` → `MP4` (the codecs
 * parameter MediaRecorder reports is not part of the tag): the caption's
 * format tag.
 */
function formatOf(blob: Blob): string {
  return (blob.type.split(';')[0].split('/')[1] ?? '').toUpperCase()
}

function fileSize(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** The caption under the preview and on each thumbnail's `aria-label`. */
function captionOf(item: ExportItem, t: Translate): string {
  return [
    item.group != null ? t('Space {n}', { n: item.group }) : null,
    item.live ? t('Live Photo') : null,
    `${item.w} × ${item.h}`,
    formatOf(item.blob),
    fileSize(item.blob.size),
  ].filter(part => part != null).join(' · ')
}

/** The popup is open while the caller has a run to show. */
function isOpen(items: ExportItem[] | null): boolean {
  return items != null && items.length > 0
}

/**
 * A new run replaces the old one and starts at its first item. Adjusting
 * state during render is React's own pattern for deriving from a prop.
 */
function isNewRun(items: ExportItem[] | null, list: ExportItem[] | null): boolean {
  return items != null && items !== list
}

/**
 * A stale selection (a shorter run than the last one) is clamped rather than
 * reset in a setter, so the strip always highlights what is on screen.
 */
function clampSelection(sel: number, list: ExportItem[] | null): number {
  return list?.length ? Math.min(sel, list.length - 1) : 0
}

function currentItem(list: ExportItem[] | null, at: number): ExportItem | null {
  return list?.[at] ?? null
}

function saveItem(item: ExportItem, t: Translate): void {
  downloadBlob(item.blob, item.name)
  say(t('Saved'))
}

async function saveAllItems(list: ExportItem[] | null, setBusy: (b: 'copy' | 'all' | null) => void, t: Translate): Promise<void> {
  if (!list)
    return
  setBusy('all')
  try {
    for (const item of list) {
      downloadBlob(item.blob, item.name)
      // Browsers throttle a burst of downloads from one gesture; a beat
      // between them keeps every file and still reads as one action.
      await new Promise(r => setTimeout(r, 200))
    }
    say(t('Saved {n} files', { n: list.length }))
  }
  finally {
    setBusy(null)
  }
}

async function copyCurrent(cur: ExportItem | null, setBusy: (b: 'copy' | 'all' | null) => void, t: Translate): Promise<void> {
  if (!cur || cur.kind !== 'image')
    return
  setBusy('copy')
  try {
    await copyImageToClipboard(cur.blob)
    say(t('Image copied'))
  }
  catch {
    say(t('Could not copy the image'))
  }
  finally {
    setBusy(null)
  }
}

/** The dialog is asked to close (only ever via a dismissal here). */
function handleOpenChange(o: boolean, onClose: () => void): void {
  if (!o)
    onClose()
}

/**
 * The close transition has finished painting: the run is off screen, so it
 * can be let go.
 */
function handleOpenChangeComplete(o: boolean, setList: (l: ExportItem[] | null) => void, onReleased: () => void): void {
  if (!o) {
    setList(null)
    onReleased()
  }
}

/**
 * The dialog's header: a single export is just "Export", a batch counts the
 * workspaces in its strip.
 */
function RunTitle({ list }: { list: ExportItem[] | null }) {
  const t = useT()
  const many = list != null && list.length > 1
  return (
    <Dialog.Title className="m-0 text-[13.5px] font-semibold">
      {many ? `${t('Export')} · ${list?.length}` : t('Export')}
    </Dialog.Title>
  )
}

/**
 * The batch's strip: one thumbnail per export, the selected one outlined, and
 * every one of them a button that brings it to the big preview. A single
 * export has nothing to switch between, so the strip is not rendered.
 */
function RunStrip({ list, at, onSelect }: { list: ExportItem[] | null, at: number, onSelect: (i: number) => void }) {
  const t = useT()
  if (!list || list.length <= 1)
    return null
  return (
    <div className="flex flex-none gap-1.5 overflow-x-auto border-b border-line bg-panel-2 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {list.map((item, i) => (
        <button
          key={item.url}
          type="button"
          aria-label={captionOf(item, t)}
          aria-pressed={i === at}
          onClick={() => onSelect(i)}
          className={`relative grid h-14 w-14 flex-none cursor-pointer place-items-center overflow-hidden border p-0 transition-[border-color,scale] duration-(--dur-fast) active:scale-[0.97] ${i === at ? 'border-accent' : 'border-line hover:border-line-strong'}`}
        >
          {item.kind === 'image'
            ? <img src={item.url} alt="" draggable={false} className="h-full w-full object-cover" />
            : (
                <span className="stage-clear grid h-full w-full place-items-center text-faint">
                  <MorphIcon icon={Play} size={14} strokeWidth={1.75} />
                </span>
              )}
          {item.live && <span className="absolute left-0 top-0 bg-black/55 px-1 text-[8px] font-bold tracking-[0.06em] text-white">LIVE</span>}
          <span className="absolute bottom-0 right-0 bg-black/55 px-[3px] text-[9px] leading-[1.35] tabular-nums text-white">{i + 1}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * The checkerboard behind the still: a PNG keeps its alpha in the preview
 * exactly as it will in the file. The popup has a height of its own, and this
 * box takes what the rows around it leave, so a control is never pushed out
 * on a short screen.
 */
function PreviewStage({ cur }: { cur: ExportItem | null }) {
  return (
    <div className="stage-clear flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
      {cur != null && (cur.kind === 'image'
        ? <img src={cur.url} alt={cur.name} className="export-shot h-full w-full object-contain shadow-[0_18px_44px_-24px_rgba(0,0,0,0.6)]" />
        : <video src={cur.url} controls playsInline preload="auto" className="h-full w-full object-contain" />)}
    </div>
  )
}

/** The one-line description of what is on screen. */
function RunCaption({ cur }: { cur: ExportItem | null }) {
  const t = useT()
  return (
    <p className="m-0 flex-none border-t border-line px-4 py-2 text-[11.5px] text-dim tabular-nums">
      {cur != null ? captionOf(cur, t) : ''}
    </p>
  )
}

/**
 * A finger is the pointer that can long-press, and WeChat's WebView blocks the
 * download button even when it reports a mouse.
 */
function LongPressHint({ coarse }: { coarse: boolean }) {
  const t = useT()
  if (!(coarse || isWeChat()))
    return null
  return (
    <p className="m-0 flex-none border-t border-line px-4 py-2 text-[11px] leading-[1.5] text-faint">
      {t('Long-press the preview to save it to your photos.')}
    </p>
  )
}

/** Delivery controls: copy the still, download the whole run, or the one shown. */
function RunFooter({ cur, list, busy, onCopy, onSaveAll, onSave }: {
  cur: ExportItem | null
  list: ExportItem[] | null
  busy: 'copy' | 'all' | null
  onCopy: () => void
  onSaveAll: () => void
  onSave: (item: ExportItem) => void
}) {
  const t = useT()
  const many = (list?.length ?? 0) > 1
  return (
    <footer className="flex flex-none items-center justify-end gap-[6px] border-t border-line px-3 py-2.5">
      {cur?.kind === 'image' && canCopyImage() && (
        <button
          type="button"
          className={`${dialogButton} border-line bg-transparent text-txt hover:bg-chip-hover`}
          disabled={busy != null}
          onClick={onCopy}
        >
          <MorphIcon
            icon={busy === 'copy' ? LoaderCircle : Copy}
            size={13}
            strokeWidth={1.75}
            className={busy === 'copy' ? ' animate-spin [animation-duration:900ms]' : ''}
          />
          {t('Copy image')}
        </button>
      )}
      {many && (
        <button
          type="button"
          className={`${dialogButton} border-line bg-transparent text-txt hover:bg-chip-hover`}
          disabled={busy != null}
          onClick={onSaveAll}
        >
          <MorphIcon
            icon={busy === 'all' ? LoaderCircle : Download}
            size={13}
            strokeWidth={1.75}
            className={busy === 'all' ? ' animate-spin [animation-duration:900ms]' : ''}
          />
          {t('Download all ({n})', { n: list?.length ?? 0 })}
        </button>
      )}
      <button
        type="button"
        className={`${dialogButton} border-accent bg-accent font-semibold text-on-accent hover:bg-accent hover:text-on-accent`}
        disabled={cur == null}
        onClick={() => cur && onSave(cur)}
      >
        <MorphIcon icon={Download} size={13} strokeWidth={1.75} />
        {cur?.kind === 'video' ? t('Download video') : t('Download image')}
      </button>
    </footer>
  )
}

/**
 * Every export lands here before it lands on disk. Rendering is the slow half
 * and happens first (the chrome keeps its spinner); this dialog is the delivery
 * half, and it is a dialog rather than a straight download because the browsers
 * that matter are the ones that block a programmatic download: WeChat's WebView
 * on a phone, where saving an exported blob either fails or vanishes, and iOS
 * Safari, where it drops into Files rather than the photo library.
 *
 * A preview is the one image in the app that is meant to leave through the
 * browser's own menus, so the still is shown full size on the app's
 * transparency checkerboard with Download and Copy as the explicit paths next
 * to it: a long-press raises the system sheet ("Save to Photos" / "Copy" on
 * iOS, "Download image" on Android), a drag or right-click the desktop's "Save
 * image as…". A run of several workspaces keeps them all in a strip at the
 * top: the big preview follows the selection, and every item downloads on its
 * own or in one go through "Download all".
 */
export function ExportDialog({ items, onClose, onReleased }: { items: ExportItem[] | null, onClose: () => void, onReleased: () => void }) {
  const t = useT()
  const [sel, setSel] = useState(0)
  const [busy, setBusy] = useState<'copy' | 'all' | null>(null)
  /**
   * The run on screen: it takes over from the `items` prop during render (see
   * below) and outlives it until the close transition finishes, so the popup
   * never animates out empty. `onOpenChangeComplete` then drops it.
   */
  const [list, setList] = useState<ExportItem[] | null>(null)

  if (isNewRun(items, list)) {
    setList(items)
    setSel(0)
  }

  const at = clampSelection(sel, list)
  const cur = currentItem(list, at)
  const coarse = useMediaQuery('(pointer: coarse)')

  return (
    <Dialog.Root
      open={isOpen(items)}
      onOpenChange={o => handleOpenChange(o, onClose)}
      onOpenChangeComplete={o => handleOpenChangeComplete(o, setList, onReleased)}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed z-(--z-modal) inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup className="fixed z-(--z-modal) left-1/2 top-1/2 flex h-[min(88dvh,760px)] max-h-[calc(100dvh-24px)] w-[min(720px,calc(100vw-16px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-line bg-panel text-txt shadow-pop outline-0 transition-[opacity,translate,scale] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <header className="flex flex-none items-center justify-between gap-2.5 border-b border-line py-[11px] pl-4 pr-3">
            <RunTitle list={list} />
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          <RunStrip list={list} at={at} onSelect={setSel} />

          <PreviewStage cur={cur} />

          <RunCaption cur={cur} />

          <LongPressHint coarse={coarse} />

          <RunFooter
            cur={cur}
            list={list}
            busy={busy}
            onCopy={() => void copyCurrent(cur, setBusy, t)}
            onSaveAll={() => void saveAllItems(list, setBusy, t)}
            onSave={item => saveItem(item, t)}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
