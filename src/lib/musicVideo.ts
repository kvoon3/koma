/**
 * A still for the poster's video mode, from iTunes' public search. Spotify's
 * oEmbed exposes the track cover but no video frame, so the still is looked up
 * separately and only used when the title and artist actually match. No key,
 * no backend; a miss is simply no still.
 */

const ITUNES = 'https://itunes.apple.com/search'

interface ItunesVideo {
  kind?: string
  trackName?: string
  artistName?: string
  artworkUrl100?: string
}

/**
 * Case, accents, bracketed suffixes and punctuation do not distinguish two
 * songs; the letters and digits do. `(Official Video)` and `[Remastered]` drop
 * out here.
 */
function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The same words before bracketed suffixes are dropped, for ranking a tie. */
function rawName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function sameName(a: string, b: string): boolean {
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
}

function matches(video: ItunesVideo, title: string, artist: string): boolean {
  if (video.kind && video.kind !== 'music-video')
    return false
  return sameName(normalize(video.trackName ?? ''), normalize(title))
    && sameName(normalize(video.artistName ?? ''), normalize(artist))
}

/** The search API returns a 100px thumbnail; the card needs the full square. */
function largerArtwork(url: string): string {
  return url.replace(/\/\d+x\d+bb\.(jpg|jpeg|png|webp)$/i, '/1200x1200bb.$1')
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    return res.ok ? await res.json() : null
  }
  finally {
    clearTimeout(timer)
  }
}

/**
 * The first music video whose title and artist match the track. A missing
 * artist is a miss rather than a title-only guess: a wrong video is worse than
 * no video mode.
 */
export async function findMusicVideoStill(title: string, artist: string): Promise<string | null> {
  const track = title.trim()
  const by = artist.trim()
  if (!track || !by)
    return null
  const query = new URLSearchParams({
    term: `${track} ${by}`,
    entity: 'musicVideo',
    limit: '12',
    country: 'us',
  })
  const body = await getJson(`${ITUNES}?${query}`)
  if (!body || typeof body !== 'object')
    return null
  const results = (body as { results?: unknown }).results
  if (!Array.isArray(results))
    return null
  const videos = results
    .filter((item): item is ItunesVideo => !!item && typeof item === 'object')
    .filter(video => matches(video, track, by) && !!video.artworkUrl100)
  const wantedTitle = rawName(track)
  const wantedArtist = rawName(by)
  const exact = videos.find(video =>
    rawName(video.trackName ?? '') === wantedTitle
    && rawName(video.artistName ?? '') === wantedArtist,
  )
  const chosen = exact ?? videos[0]
  return chosen?.artworkUrl100 ? largerArtwork(chosen.artworkUrl100) : null
}
