/**
 * Music links: what a pasted Spotify or Apple Music URL names, and how each
 * provider's public response becomes the card's title, artist and artwork.
 *
 * Everything here is pure except `resolveMusic`, which is the one browser
 * fetch. Parsing and response mapping are separate so the fiddly parts (every
 * accepted URL shape, the artwork-size upgrade, a provider answering with no
 * picture) are tested from fixtures without a network.
 */

export type MusicProvider = 'spotify' | 'apple'
export type MusicLinkKind = 'track' | 'album'

/** What a music card remembers about its source. */
export interface MusicMeta {
  provider: MusicProvider
  title: string
  artist: string
  /** The canonical open URL, with tracking query parameters dropped. */
  url: string
}

export interface SpotifyLink {
  provider: 'spotify'
  kind: MusicLinkKind
  id: string
  url: string
}

export interface AppleLink {
  provider: 'apple'
  kind: MusicLinkKind
  collectionId: string
  /** Present when the link carries `?i=`, i.e. it names one track. */
  trackId?: string
  /** The storefront from the path segment, lowercased; `us` when absent. */
  country: string
  url: string
}

export type MusicLink = SpotifyLink | AppleLink

export type MusicLinkError = 'invalid' | 'unsupported'

export type ParseMusicLink
  = | { ok: true, link: MusicLink }
    | { ok: false, error: MusicLinkError }

/** Spotify ids are 22 base62 characters, track and album alike. */
const SPOTIFY_ID = /^[a-z0-9]{22}$/i
const SPOTIFY_URI = /^spotify:(track|album):([a-z0-9]+)$/i
const DIGITS = /^\d+$/

/** The canonical forms this app writes; see `readMusicMeta`. */
const SPOTIFY_CANONICAL = /^https:\/\/open\.spotify\.com\/(?:track|album)\/[a-z0-9]{22}$/i
const APPLE_CANONICAL = /^https:\/\/music\.apple\.com\/[a-z]{2}\/album\/[^/?#]+\/\d+(?:\?i=\d+)?$/i

/**
 * Validate the source a workspace file carries. This app writes the canonical
 * provider URL, but a hand-edited file can put anything in `url`, and that
 * string becomes a link's href. Drop the metadata when it is not a canonical
 * Spotify or Apple URL for the provider it names; the card itself remains.
 */
export function readMusicMeta(value: unknown): MusicMeta | null {
  const rec = record(value)
  if (!rec)
    return null
  const provider = rec.provider
  if (provider !== 'spotify' && provider !== 'apple')
    return null
  const url = text(rec.url)
  if (provider === 'spotify' ? !SPOTIFY_CANONICAL.test(url) : !APPLE_CANONICAL.test(url))
    return null
  return { provider, title: text(rec.title), artist: text(rec.artist), url }
}

const spotifyUrl = (kind: MusicLinkKind, id: string) => `https://open.spotify.com/${kind}/${id}`

function invalid(): ParseMusicLink {
  return { ok: false, error: 'invalid' }
}

function unsupported(): ParseMusicLink {
  return { ok: false, error: 'unsupported' }
}

/**
 * Parse a pasted link. Spotify accepts `open.spotify.com/track|album/...`
 * (with an optional `intl-xx` prefix and any share query) and the
 * `spotify:track:` / `spotify:album:` URI forms. Apple accepts
 * `music.apple.com/<cc>/album/<slug>/<collectionId>[?i=<trackId>]`; without a
 * country segment the storefront is `us`, and without `i` the link is an album.
 *
 * A link to something else Spotify or Apple hosts (playlist, artist, episode,
 * podcast) is `unsupported`; anything that is not a link at all is `invalid`.
 */
export function parseMusicLink(raw: string): ParseMusicLink {
  const text = raw.trim()
  if (!text)
    return invalid()

  const uri = SPOTIFY_URI.exec(text)
  if (uri) {
    const kind = uri[1]!.toLowerCase() as MusicLinkKind
    if (!SPOTIFY_ID.test(uri[2]!))
      return invalid()
    return { ok: true, link: { provider: 'spotify', kind, id: uri[2]!, url: spotifyUrl(kind, uri[2]!) } }
  }

  let url: URL
  try {
    url = new URL(text)
  }
  catch {
    return invalid()
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return invalid()

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'open.spotify.com' || host === 'play.spotify.com')
    return parseSpotifyUrl(url)
  if (host === 'music.apple.com' || host === 'geo.music.apple.com')
    return parseAppleUrl(url)
  return invalid()
}

function parseSpotifyUrl(url: URL): ParseMusicLink {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0]?.toLowerCase().startsWith('intl-'))
    parts.shift()
  const kind = parts[0]?.toLowerCase()
  const id = parts[1]
  if (kind !== 'track' && kind !== 'album')
    return unsupported()
  if (!id || !SPOTIFY_ID.test(id))
    return invalid()
  return { ok: true, link: { provider: 'spotify', kind, id, url: spotifyUrl(kind, id) } }
}

function parseAppleUrl(url: URL): ParseMusicLink {
  const parts = url.pathname.split('/').filter(Boolean)
  let country = 'us'
  let at = 0
  if (parts[0] && /^[a-z]{2}$/i.test(parts[0]) && parts[1]?.toLowerCase() === 'album') {
    country = parts[0].toLowerCase()
    at = 1
  }
  if (parts[at]?.toLowerCase() !== 'album')
    return unsupported()
  const slug = parts[at + 1]
  const collectionId = parts[at + 2]
  if (!slug || !collectionId || !DIGITS.test(collectionId))
    return invalid()
  const rawTrack = url.searchParams.get('i')
  if (rawTrack != null && !DIGITS.test(rawTrack))
    return invalid()
  const trackId = rawTrack ?? undefined
  const canonical = `https://music.apple.com/${country}/album/${slug}/${collectionId}${trackId ? `?i=${trackId}` : ''}`
  return { ok: true, link: { provider: 'apple', kind: trackId ? 'track' : 'album', collectionId, trackId, country, url: canonical } }
}

// ---- provider responses ----------------------------------------------------

/** The artwork URL and a title, read from Spotify's oEmbed body. */
export interface SpotifyOembed {
  title: string
  /** Empty when the body carried no thumbnail. */
  artworkUrl: string
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * oEmbed answers 300x300. The artwork's own filename carries the size
 * (`ab67616d00001e02…`); the 640 variant is the same image with `0000b273`.
 * Some bodies already carry a different size, in which case the URL is used
 * as-is and the renderer scales it.
 */
export function spotifyArtworkUrl(thumbnailUrl: string): string {
  return thumbnailUrl.replace('00001e02', '0000b273')
}

export function readSpotifyOembed(json: unknown): SpotifyOembed | null {
  const body = record(json)
  if (!body)
    return null
  const title = text(body.title)
  if (!title)
    return null
  const thumbnail = text(body.thumbnail_url)
  return { title, artworkUrl: thumbnail ? spotifyArtworkUrl(thumbnail) : '' }
}

/** The keyless search that names the artist an oEmbed body leaves out. */
export function spotifyArtistSearchUrl(title: string, kind: MusicLinkKind): string {
  const entity = kind === 'track' ? 'song' : 'album'
  return `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=${entity}&limit=5&country=us`
}

/**
 * Title keys for matching a search hit. The loose pass ignores a parenthetical
 * or dash suffix (a remaster or a live take), which is still the same song for
 * naming its artist.
 */
function nameKey(text: string, loose: boolean): string {
  const base = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!loose)
    return base
  const dash = base.indexOf(' - ')
  return (dash >= 0 ? base.slice(0, dash) : base)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The artist from iTunes search results: an exact title first, then the same
 * title without a suffix. A different song that merely shares words never
 * qualifies, so a cover or a namesake cannot fill the wrong name.
 */
export function pickITunesArtist(json: unknown, title: string, kind: MusicLinkKind): string {
  const body = record(json)
  if (!body || !Array.isArray(body.results))
    return ''
  const hits = body.results
    .map(record)
    .filter((r): r is Record<string, unknown> => r != null)
    .map(r => ({ name: text(kind === 'track' ? r.trackName : r.collectionName), artist: text(r.artistName) }))
    .filter(h => h.name && h.artist)
  for (const loose of [false, true]) {
    const key = nameKey(title, loose)
    if (!key)
      return ''
    const hit = hits.find(h => nameKey(h.name, loose) === key)
    if (hit)
      return hit.artist
  }
  return ''
}

/** A failed search is not a failed resolve; the artist field stays editable. */
async function spotifyArtist(title: string, kind: MusicLinkKind, fetchImpl: MusicFetch): Promise<string> {
  try {
    const res = await fetchImpl(spotifyArtistSearchUrl(title, kind))
    if (!res.ok)
      return ''
    return pickITunesArtist(await res.json(), title, kind)
  }
  catch {
    return ''
  }
}

export interface AppleLookupResult {
  wrapperType?: string
  trackId?: number
  collectionId?: number
  trackName?: string
  collectionName?: string
  artistName?: string
  artworkUrl100?: string
}

export function readAppleResults(json: unknown): AppleLookupResult[] | null {
  const body = record(json)
  if (!body || !Array.isArray(body.results))
    return null
  return body.results.filter((r): r is AppleLookupResult => record(r) != null)
}

/** The result a link names: the track itself, or the album's collection row. */
export function pickAppleResult(results: readonly AppleLookupResult[], link: AppleLink): AppleLookupResult | null {
  if (link.kind === 'track') {
    const id = Number(link.trackId)
    return results.find(r => r.trackId === id) ?? null
  }
  const id = Number(link.collectionId)
  return results.find(r => r.wrapperType === 'collection' && r.collectionId === id) ?? null
}

/** Apple's 100x100 thumbnail becomes the 1000x1000 original art. */
export function appleArtworkUrl(url100: string): string {
  return url100.replace('100x100bb', '1000x1000bb')
}

export interface AppleArtwork {
  title: string
  artist: string
  /** Empty when the result carried no artwork. */
  artworkUrl: string
}

export function mapAppleResult(result: AppleLookupResult, link: AppleLink): AppleArtwork {
  const title = link.kind === 'track'
    ? text(result.trackName) || text(result.collectionName)
    : text(result.collectionName)
  const artwork = text(result.artworkUrl100)
  return {
    title,
    artist: text(result.artistName),
    artworkUrl: artwork ? appleArtworkUrl(artwork) : '',
  }
}

/**
 * Resolve: from a pasted link to the few fields a card needs. One fetch per
 * link, against the provider's keyless public endpoint.
 */
export type MusicResolveError = 'invalid' | 'unsupported' | 'network' | 'artwork'

export interface ResolvedMusic extends MusicMeta {
  artworkUrl: string
}

export type ResolveMusic
  = | { ok: true, music: ResolvedMusic }
    | { ok: false, error: MusicResolveError }

/** The one request each resolve makes; narrow so a test can stand in for it. */
export type MusicFetch = (url: string) => Promise<Response>

/** The public endpoint each provider answers without a key or a server. */
export function musicLookupUrl(link: MusicLink): string {
  if (link.provider === 'spotify')
    return `https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`
  const id = link.kind === 'track' ? link.trackId! : link.collectionId
  const entity = link.kind === 'track' ? 'song' : 'album'
  return `https://itunes.apple.com/lookup?id=${id}&entity=${entity}&country=${link.country}`
}

/**
 * Turn a pasted link into what the card needs. Parsing errors are the caller's
 * typed errors; a failed request is `network`; a response without usable art is
 * `artwork`. `fetchImpl` is for tests.
 */
export async function resolveMusic(raw: string, fetchImpl: MusicFetch = fetch): Promise<ResolveMusic> {
  const parsed = parseMusicLink(raw)
  if (!parsed.ok)
    return parsed
  const link = parsed.link

  let body: unknown
  try {
    const res = await fetchImpl(musicLookupUrl(link))
    if (!res.ok)
      return { ok: false, error: 'network' }
    body = await res.json()
  }
  catch {
    return { ok: false, error: 'network' }
  }

  if (link.provider === 'spotify') {
    const read = readSpotifyOembed(body)
    if (!read)
      return { ok: false, error: 'network' }
    if (!read.artworkUrl)
      return { ok: false, error: 'artwork' }
    const artist = await spotifyArtist(read.title, link.kind, fetchImpl)
    return {
      ok: true,
      music: { provider: 'spotify', title: read.title, artist, url: link.url, artworkUrl: read.artworkUrl },
    }
  }

  const results = readAppleResults(body)
  if (!results)
    return { ok: false, error: 'network' }
  const hit = pickAppleResult(results, link)
  if (!hit)
    return { ok: false, error: 'network' }
  const art = mapAppleResult(hit, link)
  if (!art.title)
    return { ok: false, error: 'network' }
  if (!art.artworkUrl)
    return { ok: false, error: 'artwork' }
  return {
    ok: true,
    music: { provider: 'apple', title: art.title, artist: art.artist, url: link.url, artworkUrl: art.artworkUrl },
  }
}
