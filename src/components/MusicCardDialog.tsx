import type { MusicResolveError, ResolvedMusic } from '../lib/musicLink'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { loadMusicArtwork, musicCardFileName, PROVIDER_LABELS, renderMusicCardBlob } from '../lib/musicCard'
import { resolveMusic } from '../lib/musicLink'
import { say } from '../lib/toast'
import { useStore } from '../store'
import { Button } from './ui/button'
import { buttonBase, buttonVariants } from './ui/buttonStyles'

/** How long the title/artist inputs settle before the preview re-renders. */
const PREVIEW_DEBOUNCE_MS = 200

function errorCopy(t: ReturnType<typeof useT>, error: MusicResolveError): string {
  switch (error) {
    case 'invalid':
      return t('That is not a Spotify or Apple Music link.')
    case 'unsupported':
      return t('That link is not a track or album.')
    case 'network':
      return t('Could not reach Spotify or Apple Music. Try again.')
    case 'artwork':
      return t('No artwork found for that link.')
  }
}

/**
 * The one music card dialog: paste a link, resolve it against the provider's
 * public response, tune the two text lines, then add the rendered square to
 * the library. Mounted once by the root layout and opened by a store flag, so
 * the stage dock and the library header share one copy and its preview state.
 *
 * Adding does not navigate: from a board the dialog closes back onto the board,
 * and the card is waiting in the library's Music filter.
 */
export function MusicCardDialog({ open, onClose }: { open: boolean, onClose: () => void }) {
  const t = useT()
  const addMusicCard = useStore(s => s.addMusicCard)

  const [link, setLink] = useState('')
  const [resolving, setResolving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [music, setMusic] = useState<ResolvedMusic | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  /** The resolved artwork, kept decoded so an edit re-renders without a fetch. */
  const artworkRef = useRef<HTMLImageElement | null>(null)
  /** The URL the preview img is showing, so a replacement can revoke it. */
  const previewRef = useRef<string | null>(null)
  /** Bumped per resolve and on close: a late answer from an older run is dropped. */
  const jobRef = useRef(0)

  const swapPreview = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob)
    const old = previewRef.current
    previewRef.current = url
    setPreviewUrl(url)
    // The img switches on the next commit; revoking the previous URL after
    // that paint keeps the old frame from blanking.
    if (old)
      window.setTimeout(() => URL.revokeObjectURL(old), 0)
  }, [])

  const reset = useCallback(() => {
    jobRef.current++
    artworkRef.current = null
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(null)
    setLink('')
    setResolving(false)
    setAdding(false)
    setError(null)
    setMusic(null)
    setTitle('')
    setArtist('')
  }, [])

  /** Every close path (button, Escape, backdrop) drops the last card's state. */
  const close = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  useEffect(() => () => {
    if (previewRef.current)
      URL.revokeObjectURL(previewRef.current)
  }, [])

  // Title and artist edits repaint the card after they settle. The artwork is
  // already decoded, so this is a canvas pass, not a network round trip.
  useEffect(() => {
    if (!music || !artworkRef.current)
      return
    const timer = window.setTimeout(() => {
      void renderMusicCardBlob(artworkRef.current!, {
        provider: music.provider,
        title,
        artist,
      }).then(swapPreview).catch(() => setError(t('No artwork found for that link.')))
    }, PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [music, title, artist, t, swapPreview])

  const generate = async () => {
    if (resolving || !link.trim())
      return
    const job = ++jobRef.current
    setResolving(true)
    setError(null)
    try {
      const out = await resolveMusic(link)
      if (jobRef.current !== job)
        return
      if (!out.ok) {
        artworkRef.current = null
        if (previewRef.current) {
          URL.revokeObjectURL(previewRef.current)
          previewRef.current = null
        }
        setMusic(null)
        setPreviewUrl(null)
        setError(errorCopy(t, out.error))
        return
      }
      const artwork = await loadMusicArtwork(out.music.artworkUrl)
      if (jobRef.current !== job)
        return
      artworkRef.current = artwork
      setMusic(out.music)
      setTitle(out.music.title)
      setArtist(out.music.artist)
    }
    catch {
      if (jobRef.current === job)
        setError(t('No artwork found for that link.'))
    }
    finally {
      if (jobRef.current === job)
        setResolving(false)
    }
  }

  const add = async () => {
    if (!music || !artworkRef.current || adding)
      return
    setAdding(true)
    setError(null)
    try {
      const blob = await renderMusicCardBlob(artworkRef.current, {
        provider: music.provider,
        title,
        artist,
      })
      const file = new File([blob], musicCardFileName(title, artist), { type: 'image/png' })
      addMusicCard(file, {
        provider: music.provider,
        title: title.trim(),
        artist: artist.trim(),
        url: music.url,
      })
      say(t('Added to library'))
      close()
    }
    catch {
      setError(t('No artwork found for that link.'))
    }
    finally {
      setAdding(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed z-(--z-modal) inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup
          data-music-dialog=""
          className="fixed z-(--z-modal) left-1/2 top-1/2 flex max-h-[min(90dvh,760px)] w-[min(520px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]"
        >
          <header className="flex flex-none items-center justify-between gap-2.5 border-b border-line py-2 pl-4 pr-2">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">{t('Music card')}</Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex flex-col gap-1.5 sm:flex-row">
              <input
                className="box-border h-[30px] min-w-0 flex-1 border border-line-strong bg-panel-2 px-2.5 text-[12.5px] text-txt outline-0 placeholder:text-dim focus-visible:border-accent"
                value={link}
                placeholder={t('Paste a Spotify or Apple Music link')}
                aria-label={t('Paste a Spotify or Apple Music link')}
                data-music-link=""
                onChange={(e) => {
                  setLink(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter')
                    return
                  e.preventDefault()
                  void generate()
                }}
              />
              <Button variant="strong" data-music-generate="" disabled={!link.trim() || resolving} onClick={() => void generate()}>
                {t('Generate')}
              </Button>
            </div>

            {/* Fixed line: the dialog must not resize as the error comes and goes. */}
            <p className={`m-0 min-h-[1.4em] text-[11px] leading-[1.4] ${error ? 'text-danger' : 'text-dim'}`} data-music-error="">
              {error ?? t('A link turns into a square card you can place like a photo.')}
            </p>

            <div className="mx-auto flex aspect-square w-full flex-none items-center justify-center overflow-hidden border border-line bg-panel-2 sm:max-w-[260px]" data-music-preview-box="">
              {previewUrl
                ? <img src={previewUrl} alt="" className="block h-full w-full object-contain" draggable={false} data-music-preview="" />
                : <span className="block h-full w-full" />}
            </div>

            {music && (
              <span className="mx-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim" data-music-provider={music.provider}>
                <span className="h-2 w-2 rounded-full" style={{ background: music.provider === 'spotify' ? '#1DB954' : '#FA243C' }} />
                {PROVIDER_LABELS[music.provider]}
              </span>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">{t('Title')}</span>
              <input
                className="box-border h-[30px] w-full border border-line-strong bg-panel-2 px-2.5 text-[12.5px] text-txt outline-0 placeholder:text-dim focus-visible:border-accent disabled:opacity-50"
                value={title}
                disabled={!music}
                aria-label={t('Title')}
                data-music-title=""
                onChange={e => setTitle(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">{t('Artist')}</span>
              <input
                className="box-border h-[30px] w-full border border-line-strong bg-panel-2 px-2.5 text-[12.5px] text-txt outline-0 placeholder:text-dim focus-visible:border-accent disabled:opacity-50"
                value={artist}
                disabled={!music}
                aria-label={t('Artist')}
                data-music-artist=""
                onChange={e => setArtist(e.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-none items-center justify-end gap-[6px] border-t border-line px-3 py-2.5">
            <Dialog.Close className={`${buttonBase} ${buttonVariants.flat}`}>{t('Cancel')}</Dialog.Close>
            <Button
              variant="strong"
              data-music-add=""
              disabled={!music || !previewUrl || adding}
              onClick={() => void add()}
            >
              {t('Add to library')}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
