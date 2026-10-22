import { afterEach, describe, expect, test } from 'bun:test'
import { fetchLyrics, firstLyricLines, lyricLinesFrom } from './lyrics'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  }) as typeof fetch
  return calls
}

describe('lyric lines', () => {
  test('timestamps and section tags are dropped, blank lines removed', () => {
    expect(lyricLinesFrom('[00:12.34] Hello\n\n[Chorus]\nWorld  \n')).toEqual(['Hello', 'World'])
  })

  test('the card takes only the leading lines it has room for', () => {
    expect(firstLyricLines('one\ntwo\nthree\nfour\nfive\nsix', 3)).toEqual(['one', 'two', 'three'])
  })
})

describe('fetching lyrics', () => {
  test('an exact track fills from its plain lyrics', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify({ plainLyrics: 'One\nTwo' })))
    expect(await fetchLyrics('Night Drive', 'Koma')).toBe('One\nTwo')
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!)
    expect(url.pathname).toBe('/api/get')
    expect(url.searchParams.get('track_name')).toBe('Night Drive')
    expect(url.searchParams.get('artist_name')).toBe('Koma')
  })

  test('a missing artist searches by title only', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify([{ plainLyrics: 'Words' }])))
    expect(await fetchLyrics('Creep', '  ')).toBe('Words')
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!)
    expect(url.pathname).toBe('/api/search')
    expect(url.searchParams.get('track_name')).toBe('Creep')
    expect(url.searchParams.has('artist_name')).toBe(false)
  })

  test('a miss falls back to search', async () => {
    let call = 0
    mockFetch(() => {
      call++
      return call === 1
        ? new Response('', { status: 404 })
        : new Response(JSON.stringify([{ plainLyrics: 'Found\nHere' }]))
    })
    expect(await fetchLyrics('Remastered Song', 'Artist')).toBe('Found\nHere')
    expect(call).toBe(2)
  })

  test('synced lyrics lose their timestamps', async () => {
    mockFetch(() => new Response(JSON.stringify({ syncedLyrics: '[00:01.00] One\n[00:02.00] Two' })))
    expect(await fetchLyrics('Song', 'Artist')).toBe('One\nTwo')
  })

  test('instrumental results are skipped', async () => {
    let call = 0
    mockFetch(() => {
      call++
      return call === 1
        ? new Response(JSON.stringify({ instrumental: true, plainLyrics: 'no words' }))
        : new Response(JSON.stringify([
            { instrumental: true, plainLyrics: 'no words' },
            { plainLyrics: 'The words' },
          ]))
    })
    expect(await fetchLyrics('Song', 'Artist')).toBe('The words')
  })

  test('nothing found is null, not an error', async () => {
    mockFetch(() => new Response(JSON.stringify([])))
    expect(await fetchLyrics('Song', 'Artist')).toBeNull()
  })

  test('a network failure rejects so a manual request can say so', async () => {
    mockFetch(() => {
      throw new Error('offline')
    })
    expect(fetchLyrics('Song', 'Artist')).rejects.toThrow('offline')
  })
})
