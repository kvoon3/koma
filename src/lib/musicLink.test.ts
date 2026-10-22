import type { MusicFetch } from './musicLink'
import { describe, expect, test } from 'bun:test'
import {
  appleArtworkUrl,
  mapAppleResult,
  musicLookupUrl,
  parseMusicLink,
  pickAppleResult,
  readAppleResults,
  readMusicMeta,
  readSpotifyOembed,
  resolveMusic,
  spotifyArtworkUrl,
} from './musicLink'

const spotifyTrack = {
  html: '<iframe></iframe>',
  title: 'Never Gonna Give You Up',
  thumbnail_url: 'https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02255e131abc1410833be95673',
  thumbnail_width: 300,
  thumbnail_height: 300,
}

const appleTrack = {
  wrapperType: 'track',
  kind: 'song',
  trackId: 1559885421,
  collectionId: 1559885420,
  trackName: 'Never Gonna Give You Up',
  collectionName: 'Whenever You Need Somebody',
  artistName: 'Rick Astley',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/ce/6d/5b/x.jpg/100x100bb.jpg',
}

const appleAlbum = {
  wrapperType: 'collection',
  collectionType: 'Album',
  collectionId: 1559885420,
  collectionName: 'Whenever You Need Somebody',
  artistName: 'Rick Astley',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/ce/6d/5b/x.jpg/100x100bb.jpg',
}

describe('spotify links', () => {
  test('track and album URLs, the intl prefix and a share query all parse', () => {
    expect(parseMusicLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toEqual({
      ok: true,
      link: {
        provider: 'spotify',
        kind: 'track',
        id: '4uLU6hMCjMI75M1A2tKUQC',
        url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      },
    })
    const intl = parseMusicLink('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123')
    expect(intl.ok && intl.link.kind).toBe('track')
    expect(intl.ok && intl.link.url).toBe('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')
    const album = parseMusicLink('https://open.spotify.com/album/6XhjNHCyCDyyGJRM5mg40G')
    expect(album.ok && album.link.kind).toBe('album')
  })

  test('spotify: URIs parse to the same canonical URL', () => {
    expect(parseMusicLink('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toEqual({
      ok: true,
      link: {
        provider: 'spotify',
        kind: 'track',
        id: '4uLU6hMCjMI75M1A2tKUQC',
        url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      },
    })
    expect(parseMusicLink('spotify:album:6XhjNHCyCDyyGJRM5mg40G')).toMatchObject({ ok: true, link: { kind: 'album' } })
  })

  test('a playlist, artist or episode is unsupported; a short id is invalid', () => {
    for (const raw of [
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      'https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt',
      'https://open.spotify.com/episode/2aB2f5K3S4u1j8',
    ])
      expect(parseMusicLink(raw)).toEqual({ ok: false, error: 'unsupported' })
    expect(parseMusicLink('https://open.spotify.com/track/short')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('apple links', () => {
  test('a track link carries its storefront and track id', () => {
    expect(parseMusicLink('https://music.apple.com/us/album/never-gonna-give-you-up/1559885420?i=1559885421')).toEqual({
      ok: true,
      link: {
        provider: 'apple',
        kind: 'track',
        collectionId: '1559885420',
        trackId: '1559885421',
        country: 'us',
        url: 'https://music.apple.com/us/album/never-gonna-give-you-up/1559885420?i=1559885421',
      },
    })
  })

  test('an album link has no track id, and the storefront defaults to us', () => {
    const us = parseMusicLink('https://music.apple.com/album/whenever-you-need-somebody/1559885420')
    expect(us.ok && us.link).toMatchObject({ kind: 'album', country: 'us' })
    const jp = parseMusicLink('https://music.apple.com/jp/album/whenever-you-need-somebody/1559885420?l=ja')
    expect(jp.ok && jp.link.provider === 'apple' && jp.link.country).toBe('jp')
    expect(jp.ok && jp.link.kind).toBe('album')
  })

  test('playlists and artists are unsupported; a missing id is invalid', () => {
    expect(parseMusicLink('https://music.apple.com/us/playlist/todays-hits/pl.abc')).toEqual({ ok: false, error: 'unsupported' })
    expect(parseMusicLink('https://music.apple.com/us/artist/rick-astley/669771')).toEqual({ ok: false, error: 'unsupported' })
    expect(parseMusicLink('https://music.apple.com/us/album/never-gonna-give-you-up')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('things that are not links', () => {
  test('blank text, a non-URL, another host and a non-http scheme are invalid', () => {
    for (const raw of ['', '   ', 'not a link', 'https://example.com/track/4uLU6hMCjMI75M1A2tKUQC', 'spotify:playlist:abc'])
      expect(parseMusicLink(raw).ok).toBe(false)
    expect(parseMusicLink('file:///tmp/x')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('provider responses', () => {
  test('oEmbed gives the title and the 640 artwork variant', () => {
    expect(readSpotifyOembed(spotifyTrack)).toEqual({
      title: 'Never Gonna Give You Up',
      artworkUrl: 'https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273255e131abc1410833be95673',
    })
    expect(spotifyArtworkUrl('https://i.scdn.co/image/ab67616d00001e02abc')).toBe('https://i.scdn.co/image/ab67616d0000b273abc')
    expect(spotifyArtworkUrl('https://i.scdn.co/image/ab123456abc')).toBe('https://i.scdn.co/image/ab123456abc')
  })

  test('an oEmbed body with no thumbnail keeps the title but no artwork', () => {
    expect(readSpotifyOembed({ title: 'Track' })).toEqual({ title: 'Track', artworkUrl: '' })
    expect(readSpotifyOembed({ thumbnail_url: 'x' })).toBeNull()
  })

  test('the apple track result maps, and its 100 thumbnail becomes 1000', () => {
    const results = readAppleResults({ resultCount: 1, results: [appleTrack] })
    expect(results).not.toBeNull()
    const link = parseMusicLink('https://music.apple.com/us/album/never-gonna-give-you-up/1559885420?i=1559885421')
    if (!link.ok || link.link.provider !== 'apple')
      throw new Error('fixture link did not parse')
    const hit = pickAppleResult(results!, link.link)
    expect(hit).toEqual(appleTrack)
    expect(mapAppleResult(hit!, link.link)).toEqual({
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/ce/6d/5b/x.jpg/1000x1000bb.jpg',
    })
    expect(appleArtworkUrl('https://x/100x100bb.jpg')).toBe('https://x/1000x1000bb.jpg')
  })

  test('an album link picks the collection row, not a member track', () => {
    const results = readAppleResults({ results: [appleAlbum, appleTrack] })!
    const link = parseMusicLink('https://music.apple.com/us/album/whenever-you-need-somebody/1559885420')
    if (!link.ok || link.link.provider !== 'apple')
      throw new Error('fixture link did not parse')
    expect(pickAppleResult(results, link.link)).toEqual(appleAlbum)
    expect(mapAppleResult(appleAlbum, link.link).title).toBe('Whenever You Need Somebody')
  })

  test('a body without a results array is not a lookup answer', () => {
    expect(readAppleResults({})).toBeNull()
    expect(readAppleResults([])).toBeNull()
  })
})

describe('resolveMusic', () => {
  const ok = (body: unknown): MusicFetch => async () => new Response(JSON.stringify(body), { status: 200 })

  test('a parse failure never reaches the network', async () => {
    let called = false
    const fetchImpl: MusicFetch = async () => {
      called = true
      return new Response('{}')
    }
    expect(await resolveMusic('nope', fetchImpl)).toEqual({ ok: false, error: 'invalid' })
    expect(called).toBe(false)
  })

  test('spotify resolves a title with no artist and the 640 art', async () => {
    const out = await resolveMusic('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', ok(spotifyTrack))
    expect(out.ok && out.music).toEqual({
      provider: 'spotify',
      title: 'Never Gonna Give You Up',
      artist: '',
      url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      artworkUrl: 'https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273255e131abc1410833be95673',
    })
  })

  test('apple resolves the prefilled artist', async () => {
    const out = await resolveMusic(
      'https://music.apple.com/us/album/never-gonna-give-you-up/1559885420?i=1559885421',
      ok({ results: [appleTrack] }),
    )
    expect(out.ok && out.music).toMatchObject({ provider: 'apple', title: 'Never Gonna Give You Up', artist: 'Rick Astley' })
  })

  test('network and artwork failures are told apart', async () => {
    const down: MusicFetch = async () => {
      throw new Error('offline')
    }
    expect(await resolveMusic('spotify:track:4uLU6hMCjMI75M1A2tKUQC', down)).toEqual({ ok: false, error: 'network' })
    const bad: MusicFetch = async () => new Response('{}', { status: 500 })
    expect(await resolveMusic('spotify:track:4uLU6hMCjMI75M1A2tKUQC', bad)).toEqual({ ok: false, error: 'network' })
    expect(await resolveMusic('spotify:track:4uLU6hMCjMI75M1A2tKUQC', ok({ title: 'Track' }))).toEqual({ ok: false, error: 'artwork' })
    expect(await resolveMusic('https://music.apple.com/us/album/a/1559885420', ok({ results: [{ wrapperType: 'collection', collectionId: 1559885420, collectionName: 'A' }] }))).toEqual({ ok: false, error: 'artwork' })
  })

  test('each provider is asked at its public endpoint', () => {
    const s = parseMusicLink('https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC?si=x')
    const a = parseMusicLink('https://music.apple.com/jp/album/slug/1559885420?i=1559885421')
    if (!s.ok || !a.ok)
      throw new Error('fixtures did not parse')
    expect(musicLookupUrl(s.link)).toBe('https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F4uLU6hMCjMI75M1A2tKUQC')
    expect(musicLookupUrl(a.link)).toBe('https://itunes.apple.com/lookup?id=1559885421&entity=song&country=jp')
  })
})

describe('music metadata from a workspace file', () => {
  test('the two canonical provider URLs are kept', () => {
    expect(readMusicMeta({
      provider: 'spotify',
      title: 'Never Gonna Give You Up',
      artist: '',
      url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    })).toEqual({
      provider: 'spotify',
      title: 'Never Gonna Give You Up',
      artist: '',
      url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    })
    expect(readMusicMeta({
      provider: 'apple',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      url: 'https://music.apple.com/us/album/never-gonna-give-you-up/1559885420?i=1559885421',
    })).toMatchObject({ provider: 'apple', artist: 'Rick Astley' })
  })

  test('an arbitrary href is dropped rather than becoming an anchor', () => {
    for (const url of [
      'javascript:alert(1)',
      'https://evil.example/track/4uLU6hMCjMI75M1A2tKUQC',
      'https://open.spotify.com/track/short',
    ]) {
      expect(readMusicMeta({ provider: 'spotify', title: 'x', artist: '', url })).toBeNull()
    }
  })

  test('the URL has to match the provider it names', () => {
    expect(readMusicMeta({
      provider: 'spotify',
      title: 'x',
      artist: '',
      url: 'https://music.apple.com/us/album/a/1559885420',
    })).toBeNull()
    expect(readMusicMeta(null)).toBeNull()
    expect(readMusicMeta('spotify')).toBeNull()
  })
})
