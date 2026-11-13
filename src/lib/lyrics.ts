/**
 * Lyrics for a card, from LRCLIB's public API. There is no backend and no key:
 * the browser asks for plain lyrics by the track's own title and artist, and
 * the service caches the answer. Nothing is stored in the workspace.
 */

const LRCLIB = 'https://lrclib.net/api'

interface LrcLibTrack {
  instrumental?: boolean | undefined
  plainLyrics?: string | null | undefined
  syncedLyrics?: string | null | undefined
}

/** The three fields this file reads, all absent-safe, from an untrusted body. */
function readTrack(value: unknown): LrcLibTrack | null {
  if (typeof value !== 'object' || value === null)
    return null
  const instrumental = 'instrumental' in value ? value.instrumental : undefined
  const plainLyrics = 'plainLyrics' in value ? value.plainLyrics : undefined
  const syncedLyrics = 'syncedLyrics' in value ? value.syncedLyrics : undefined
  if (instrumental !== undefined && typeof instrumental !== 'boolean')
    return null
  if (plainLyrics !== undefined && plainLyrics !== null && typeof plainLyrics !== 'string')
    return null
  if (syncedLyrics !== undefined && syncedLyrics !== null && typeof syncedLyrics !== 'string')
    return null
  return { instrumental, plainLyrics, syncedLyrics }
}

/** Strip LRC timestamps and section tags; drop blank lines. */
export function lyricLinesFrom(raw: string): string[] {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/^\s*(?:\[[^\]]*\]\s*)+/, '').trim())
    .filter(line => line.length > 0)
}

/** The lines a card has room for, in the order the song sings them. */
export function firstLyricLines(raw: string, max = 5): string[] {
  return lyricLinesFrom(raw).slice(0, max)
}

function plainFrom(track: LrcLibTrack): string | null {
  if (track.instrumental)
    return null
  const raw = track.plainLyrics || track.syncedLyrics
  if (!raw)
    return null
  const lines = lyricLinesFrom(raw)
  return lines.length ? lines.join('\n') : null
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

function firstWithLyrics(results: unknown): string | null {
  if (!Array.isArray(results))
    return null
  for (const item of results) {
    const track = readTrack(item)
    if (track) {
      const text = plainFrom(track)
      if (text)
        return text
    }
  }
  return null
}

/**
 * Find plain lyrics for a resolved track. With both names, the exact lookup
 * goes first and a miss falls back to search, which tolerates remaster
 * suffixes. Spotify's oEmbed gives no artist, so a title-only search is a
 * normal path, not an error. A network failure rejects so a manual request
 * can tell the user it did not answer.
 */
export async function fetchLyrics(title: string, artist: string): Promise<string | null> {
  const track = title.trim()
  const by = artist.trim()
  if (!track)
    return null
  if (by) {
    const exact = await getJson(`${LRCLIB}/get?${new URLSearchParams({ track_name: track, artist_name: by })}`)
    const exactTrack = readTrack(exact)
    if (exactTrack) {
      const text = plainFrom(exactTrack)
      if (text)
        return text
    }
  }
  const search = new URLSearchParams({ track_name: track })
  if (by)
    search.set('artist_name', by)
  return firstWithLyrics(await getJson(`${LRCLIB}/search?${search}`))
}
