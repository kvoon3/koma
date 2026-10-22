import type { TKey } from '../lib/i18n'
import type { LyricSize, MusicCardStyle } from '../lib/musicCard'
import type { MusicResolveError, ResolvedMusic } from '../lib/musicLink'
import { Dialog } from '@base-ui/react/dialog'
import { AlignLeft, Image as ImageIcon, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { fetchLyrics } from '../lib/lyrics'
import { DEFAULT_MUSIC_CARD_STYLE, loadMusicArtwork, LYRIC_SIZE_SCALE, MUSIC_CARD_STYLE_IDS, musicCardFileName, PROVIDER_COLORS, PROVIDER_LABELS, renderMusicCardBlob } from '../lib/musicCard'
import { resolveMusic } from '../lib/musicLink'
import { findLeaf } from '../lib/panes'
import { say } from '../lib/toast'
import { activeWs, useStore } from '../store'
import { chipOffCls, chipOnCls } from './library/chips'
import { Button } from './ui/button'
import { buttonBase, buttonVariants } from './ui/buttonStyles'

/** How long the title, artist and lyrics settle before the preview re-renders. */
const PREVIEW_DEBOUNCE_MS = 200

/** The switch's names; the rendered card carries the variant itself. */
const STYLE_LABELS: Record<MusicCardStyle, TKey> = {
  cover: 'Cover',
  lyrics: 'Lyrics',
}

const STYLE_ICONS: Record<MusicCardStyle, typeof ImageIcon> = {
  cover: ImageIcon,
  lyrics: AlignLeft,
}

const LYRIC_SIZE_IDS: LyricSize[] = ['s', 'm', 'l']
const LYRIC_SIZE_LABELS: Record<LyricSize, string> = {
  s: 'S',
  m: 'M',
  l: 'L',
}
const LYRIC_SIZE_NAMES: Record<LyricSize, TKey> = {
  s: 'Small',
  m: 'Medium',
  l: 'Large',
}

/** The preview and its switch share one column width at every size. */
const STAGE_W = 'w-[min(100%,300px,38dvh)] md:w-[min(100%,360px,48dvh)]'

const SEGMENT = 'flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 text-[12px] transition-colors duration-(--dur-fast) disabled:cursor-default disabled:opacity-50'
const TEXT_ACTION = 'cursor-pointer border-0 bg-transparent p-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim underline decoration-line-strong underline-offset-2 transition-colors duration-(--dur-fast) hover:text-txt disabled:cursor-default disabled:opacity-50'

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
 * public response, switch between the cover and lyric cards, tune the text,
 * then render the card. Mounted once by the root layout and opened by a store
 * flag, so the stage dock and the library header share one copy and its
 * preview state.
 *
 * From a board the finished card goes straight into the focused cell and the
 * library; from the library header it is only added there. Adding never
 * navigates: the dialog closes back onto whatever surface opened it.
 */
export function MusicCardDialog({ open, onClose }: { open: boolean, onClose: () => void }) {
  const t = useT()
  const addMusicCard = useStore(s => s.addMusicCard)
  const assign = useStore(s => s.assign)
  const musicCardFor = useStore(s => s.musicCardFor)
  const targetOccupied = useStore((s) => {
    if (!s.musicCardFor)
      return false
    return !!findLeaf(activeWs(s).root, s.musicCardFor)?.photoId
  })

  const [link, setLink] = useState('')
  const [resolving, setResolving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [music, setMusic] = useState<ResolvedMusic | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [lyricsBusy, setLyricsBusy] = useState(false)
  const [lyricsNote, setLyricsNote] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  /** The composition; kept across opens, like a tool setting. */
  const [style, setStyle] = useState<MusicCardStyle>(DEFAULT_MUSIC_CARD_STYLE)
  /** How far the lyric type steps; lines wrap at every step. */
  const [lyricSize, setLyricSize] = useState<LyricSize>('l')

  /** The resolved artwork, kept decoded so an edit re-renders without a fetch. */
  const artworkRef = useRef<HTMLImageElement | null>(null)
  /** The URL the preview img is showing, so a replacement can revoke it. */
  const previewRef = useRef<string | null>(null)
  /** Bumped per resolve and on close: a late answer from an older run is dropped. */
  const jobRef = useRef(0)
  /** Bumped per lyrics request so a late answer cannot land on a new track. */
  const lyricsJobRef = useRef(0)
  /** A manual edit wins over a silent lookup that was already in flight. */
  const lyricsTouchedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  /** Center and cap the popup inside the visible box, keyboard included. */
  const syncPopup = useCallback(() => {
    const popup = popupRef.current
    const v = window.visualViewport
    if (!popup || !v?.height)
      return
    popup.style.top = `${v.offsetTop + v.height / 2}px`
    popup.style.maxHeight = `${Math.min(780, v.height * 0.92)}px`
  }, [])

  // The popup portal mounts after the open effect, so the ref callback is what
  // first sizes it; the effect only keeps it in step with the viewport.
  const setPopup = useCallback((node: HTMLDivElement | null) => {
    const old = popupRef.current
    if (old && old !== node) {
      old.style.top = ''
      old.style.maxHeight = ''
    }
    popupRef.current = node
    if (node)
      syncPopup()
  }, [syncPopup])

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
    lyricsJobRef.current++
    lyricsTouchedRef.current = false
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
    setLyrics('')
    setLyricsBusy(false)
    setLyricsNote(null)
    scrollRef.current?.scrollTo({ top: 0 })
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

  // A phone keyboard shrinks the visual viewport without resizing the layout
  // viewport, and a fixed dialog would leave its footer behind the keyboard.
  useEffect(() => {
    if (!open)
      return
    syncPopup()
    const v = window.visualViewport
    if (!v)
      return
    v.addEventListener('resize', syncPopup)
    v.addEventListener('scroll', syncPopup)
    return () => {
      v.removeEventListener('resize', syncPopup)
      v.removeEventListener('scroll', syncPopup)
      const popup = popupRef.current
      if (popup) {
        popup.style.top = ''
        popup.style.maxHeight = ''
      }
    }
  }, [open, syncPopup])

  // Title, artist, lyrics and the size step repaint the card after they
  // settle. The artwork is already decoded, so this is a canvas pass.
  useEffect(() => {
    if (!music || !artworkRef.current)
      return
    const timer = window.setTimeout(() => {
      void renderMusicCardBlob(artworkRef.current!, {
        provider: music.provider,
        title,
        artist,
        lyrics,
        lyricScale: LYRIC_SIZE_SCALE[lyricSize],
        style,
      }).then(swapPreview).catch(() => setError(t('No artwork found for that link.')))
    }, PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [music, title, artist, lyrics, lyricSize, style, t, swapPreview])

  /**
   * Ask LRCLIB for the track's words. A resolve fills them silently; the
   * button says when nothing came back. The request never blocks the preview,
   * and a new track or a close invalidates a late answer.
   */
  const findLyrics = useCallback(async (titleText: string, artistText: string, announce: boolean) => {
    if (!titleText.trim())
      return
    if (announce)
      setStyle('lyrics')
    const job = ++lyricsJobRef.current
    setLyricsBusy(true)
    setLyricsNote(null)
    try {
      const text = await fetchLyrics(titleText.trim(), artistText.trim())
      if (lyricsJobRef.current !== job)
        return
      if (text) {
        if (!announce && lyricsTouchedRef.current)
          return
        setLyrics(text)
        return
      }
      if (announce)
        setLyricsNote(t('No lyrics found. Paste them below.'))
    }
    catch {
      if (lyricsJobRef.current === job && announce)
        setLyricsNote(t('Could not reach LRCLIB. Paste lyrics below.'))
    }
    finally {
      if (lyricsJobRef.current === job)
        setLyricsBusy(false)
    }
  }, [t])

  const chooseStyle = (next: MusicCardStyle) => {
    setStyle(next)
    // The lyric card needs words; tapping it on a fresh track asks for them.
    if (next === 'lyrics' && !lyrics.trim() && title.trim())
      void findLyrics(title, artist, true)
  }

  const generate = async () => {
    if (resolving || !link.trim())
      return
    const job = ++jobRef.current
    lyricsJobRef.current++
    lyricsTouchedRef.current = false
    setLyrics('')
    setLyricsBusy(false)
    setLyricsNote(null)
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
      void findLyrics(out.music.title, out.music.artist, false)
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
        lyrics,
        lyricScale: LYRIC_SIZE_SCALE[lyricSize],
        style,
      })
      const file = new File([blob], musicCardFileName(title, artist), { type: 'image/png' })
      const photo = addMusicCard(file, {
        provider: music.provider,
        title: title.trim(),
        artist: artist.trim(),
        url: music.url,
      })
      // The card is always an asset; a board target is a second, one-step
      // placement. A stale target falls back to the library-only outcome.
      const placed = musicCardFor ? assign(musicCardFor, photo.id, true) : false
      say(placed ? t('Card placed in the collage') : t('Added to library'))
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
          ref={setPopup}
          data-music-dialog=""
          className="fixed z-(--z-modal) left-1/2 top-1/2 flex max-h-[min(92dvh,780px)] w-[min(880px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]"
        >
          <header className="flex flex-none items-center justify-between gap-2.5 border-b border-line py-2 pl-4 pr-2">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">{t('Music card')}</Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-4" data-music-scroll="">
            <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,360px)_minmax(0,1fr)] md:items-start md:gap-5">
              <div className="flex flex-col items-center gap-2 md:sticky md:top-0" data-music-stage="">
                <div className={`${STAGE_W} flex flex-col gap-2`}>
                  <div
                    className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[10px] border border-line bg-panel-2"
                    data-music-preview-box=""
                  >
                    {previewUrl
                      ? <img src={previewUrl} alt="" className="block h-full w-full object-contain" draggable={false} data-music-preview="" />
                      : (
                          <span className="flex flex-col items-center gap-1.5 px-4 text-center text-[11px] leading-[1.4] text-dim" data-music-preview-empty="">
                            <MorphIcon icon={ImageIcon} size={20} strokeWidth={1.5} />
                            {t('Your card appears here')}
                          </span>
                        )}
                  </div>

                  {/* One control, two cards: the Spotify swap without a row of chips. */}
                  <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-panel-2 p-1" role="group" aria-label={t('Card style')} data-music-styles="">
                    {MUSIC_CARD_STYLE_IDS.map((id) => {
                      const Icon = STYLE_ICONS[id]
                      const on = style === id
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`${SEGMENT} ${on ? 'bg-txt text-panel' : 'bg-transparent text-dim hover:text-txt'}`}
                          aria-pressed={on}
                          data-music-style={id}
                          disabled={adding}
                          onClick={() => chooseStyle(id)}
                        >
                          <MorphIcon icon={Icon} size={14} strokeWidth={1.8} />
                          {t(STYLE_LABELS[id])}
                        </button>
                      )
                    })}
                  </div>

                  {style === 'lyrics' && (
                    <div className="flex items-center justify-between gap-2 px-1" data-music-lyric-size-row="">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">{t('Text size')}</span>
                      <div className="grid grid-cols-3 gap-[4px]" data-music-lyric-sizes="">
                        {LYRIC_SIZE_IDS.map(id => (
                          <button
                            key={id}
                            type="button"
                            className={`flex h-7 w-8 cursor-pointer items-center justify-center border text-[11px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] disabled:cursor-default disabled:opacity-50 ${lyricSize === id ? chipOnCls : chipOffCls}`}
                            aria-pressed={lyricSize === id}
                            aria-label={t(LYRIC_SIZE_NAMES[id])}
                            data-music-lyric-size={id}
                            disabled={adding}
                            onClick={() => setLyricSize(id)}
                          >
                            {LYRIC_SIZE_LABELS[id]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-1.5 sm:flex-row">
                  <input
                    className="box-border h-[32px] min-w-0 flex-1 border border-line-strong bg-panel-2 px-2.5 text-[12.5px] text-txt outline-0 placeholder:text-dim focus-visible:border-accent"
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
                  <span className="flex flex-none">
                    <Button variant="strong" data-music-generate="" disabled={!link.trim() || resolving} onClick={() => void generate()}>
                      {t('Generate')}
                    </Button>
                  </span>
                </div>

                {/* Fixed line: the dialog must not resize as the error comes and goes. */}
                <p className={`m-0 min-h-[1.4em] text-[11px] leading-[1.4] ${error ? 'text-danger' : 'text-dim'}`} data-music-error="">
                  {error ?? (musicCardFor
                    ? t('Goes into this cell; a copy stays in the library.')
                    : t('A link turns into a card you can place like a photo.'))}
                </p>

                {music && (
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim" data-music-provider={music.provider}>
                    <span className="h-2 w-2 rounded-full" style={{ background: PROVIDER_COLORS[music.provider] }} />
                    {PROVIDER_LABELS[music.provider]}
                  </span>
                )}

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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

                {style === 'lyrics' && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">{t('Lyrics')}</span>
                      <button
                        type="button"
                        className={TEXT_ACTION}
                        data-music-find-lyrics=""
                        disabled={!music || lyricsBusy || !title.trim()}
                        onClick={() => void findLyrics(title, artist, true)}
                      >
                        {lyricsBusy ? t('Finding lyrics') : t('Find lyrics')}
                      </button>
                    </div>
                    <textarea
                      className="box-border min-h-[88px] w-full resize-y border border-line-strong bg-panel-2 px-2.5 py-1.5 text-[12.5px] leading-[1.4] text-txt outline-0 placeholder:text-dim focus-visible:border-accent disabled:opacity-50"
                      rows={4}
                      value={lyrics}
                      disabled={!music}
                      aria-label={t('Lyrics')}
                      placeholder={t('Paste lyrics, or find them above')}
                      data-music-lyrics=""
                      onChange={(e) => {
                        lyricsTouchedRef.current = true
                        setLyrics(e.target.value)
                      }}
                    />
                    <span className="min-h-[1.4em] text-[10px] leading-[1.4] text-dim" data-music-lyrics-note="">
                      {lyricsNote ?? t('The lyric card uses the first three lines.')}
                    </span>
                  </div>
                )}
              </div>
            </div>
            {/* The form scrolls under the footer. The fade rides the body's
                bottom edge as the scroll cue and settles into the padding at
                the end. */}
            <div
              aria-hidden
              className="pointer-events-none sticky bottom-0 -mx-4 -mt-2.5 -mb-4 h-3 shrink-0"
              style={{ background: 'linear-gradient(to top, var(--panel), transparent)' }}
            />
          </div>

          <div className="flex flex-none items-center justify-end gap-[6px] border-t border-line bg-panel px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
            <Dialog.Close className={`${buttonBase} ${buttonVariants.flat}`}>{t('Cancel')}</Dialog.Close>
            <Button
              variant="strong"
              data-music-add=""
              disabled={!music || !previewUrl || adding}
              onClick={() => void add()}
            >
              {musicCardFor
                ? targetOccupied ? t('Replace this cell') : t('Insert into this cell')
                : t('Add to library')}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
