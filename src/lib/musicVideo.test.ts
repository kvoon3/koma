import { afterEach, describe, expect, test } from 'bun:test'
import { findMusicVideoStill } from './musicVideo'

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

function video(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'music-video',
    trackName: 'Creep',
    artistName: 'Radiohead',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Video/creep/100x100bb.jpg',
    ...overrides,
  }
}

describe('finding a video still', () => {
  test('an exact title and artist return the full-size artwork', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify({ results: [video()] })))
    expect(await findMusicVideoStill('Creep', 'Radiohead')).toBe('https://is1-ssl.mzstatic.com/image/thumb/Video/creep/1200x1200bb.jpg')
    const url = new URL(calls[0]!)
    expect(url.hostname).toBe('itunes.apple.com')
    expect(url.searchParams.get('entity')).toBe('musicVideo')
    expect(url.searchParams.get('term')).toBe('Creep Radiohead')
  })

  test('a bracketed video suffix still matches its song', async () => {
    mockFetch(() => new Response(JSON.stringify({ results: [video({ trackName: 'Creep (Official Video)' })] })))
    expect(await findMusicVideoStill('Creep', 'Radiohead')).toContain('1200x1200bb')
  })

  test('an exact result wins over a live version listed first', async () => {
    mockFetch(() => new Response(JSON.stringify({
      results: [
        video({ trackName: 'Creep (Live)', artworkUrl100: 'https://is1-ssl.mzstatic.com/live/100x100bb.jpg' }),
        video({ artworkUrl100: 'https://is1-ssl.mzstatic.com/studio/100x100bb.jpg' }),
      ],
    })))
    expect(await findMusicVideoStill('Creep', 'Radiohead')).toContain('/studio/')
  })

  test('another artist is not accepted', async () => {
    mockFetch(() => new Response(JSON.stringify({ results: [video({ artistName: 'Arlo Parks' })] })))
    expect(await findMusicVideoStill('Creep', 'Radiohead')).toBeNull()
  })

  test('a non-video result is ignored', async () => {
    mockFetch(() => new Response(JSON.stringify({ results: [video({ kind: 'song' })] })))
    expect(await findMusicVideoStill('Creep', 'Radiohead')).toBeNull()
  })

  test('a title with no artist is a miss without a request', async () => {
    const calls = mockFetch(() => new Response(JSON.stringify({ results: [video()] })))
    expect(await findMusicVideoStill('Creep', '  ')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  test('no results is null', async () => {
    mockFetch(() => new Response(JSON.stringify({ resultCount: 0, results: [] })))
    expect(await findMusicVideoStill('Creep', 'Radiohead')).toBeNull()
  })

  test('a network failure rejects so the dialog can say so', () => {
    mockFetch(() => {
      throw new Error('offline')
    })
    expect(findMusicVideoStill('Creep', 'Radiohead')).rejects.toThrow('offline')
  })
})
