/// <reference types="bun" />
import type { ResolvedMusic } from './musicLink'
import { describe, expect, test } from 'bun:test'
import { canAdd, canFindLyrics, canGenerate, MUSIC_CARD_FLOW, musicCardTransition, musicLyricsBusy, musicResolving } from './musicCardFlow'

const track: ResolvedMusic = {
  provider: 'spotify',
  title: 'Song',
  artist: 'Artist',
  url: 'https://open.spotify.com/track/1234567890123456789012',
  artworkUrl: 'https://example.com/art.jpg',
}

const generating = musicCardTransition(MUSIC_CARD_FLOW, { type: 'generate' })
const ready = musicCardTransition(generating, { type: 'resolved', music: track })

describe('musicCardTransition resolve', () => {
  test('generate starts a resolve from idle or ready, never twice', () => {
    expect(generating.phase).toBe('resolving')
    expect(musicResolving(generating)).toBe(true)
    expect(canGenerate(generating)).toBe(false)
    expect(musicCardTransition(generating, { type: 'generate' })).toBe(generating)
    expect(canGenerate(ready)).toBe(true)
  })

  test('a resolved track unlocks add and lyrics', () => {
    expect(ready.phase).toBe('ready')
    expect(ready.music).toBe(track)
    expect(canAdd(ready)).toBe(true)
    expect(canFindLyrics(ready)).toBe(true)
  })

  test('the previous track stays visible while resolving but is not addable', () => {
    const resolvingNext = musicCardTransition(ready, { type: 'generate' })
    expect(resolvingNext.music).toBe(track)
    expect(canAdd(resolvingNext)).toBe(false)
    expect(canFindLyrics(resolvingNext)).toBe(false)
  })

  test('a failed resolve clears the preview and reports the error', () => {
    const failed = musicCardTransition(generating, { type: 'resolve-failed', error: 'nope' })
    expect(failed).toEqual({ phase: 'idle', music: null, error: 'nope', lyrics: 'idle', lyricsNote: null })
  })

  test('a preview render failure is a note, not a phase change', () => {
    const failed = musicCardTransition(ready, { type: 'error', error: 'no artwork' })
    expect(failed.phase).toBe('ready')
    expect(failed.music).toBe(track)
    expect(failed.error).toBe('no artwork')
    expect(canAdd(failed)).toBe(true)
  })

  test('stale resolve events are refused', () => {
    expect(musicCardTransition(MUSIC_CARD_FLOW, { type: 'resolved', music: track })).toBe(MUSIC_CARD_FLOW)
    expect(musicCardTransition(ready, { type: 'resolve-failed', error: 'nope' })).toBe(ready)
  })
})

describe('musicCardTransition add', () => {
  test('add is single-flight and a failure returns to ready with the error', () => {
    const adding = musicCardTransition(ready, { type: 'add' })
    expect(adding.phase).toBe('adding')
    expect(canAdd(adding)).toBe(false)
    expect(musicCardTransition(adding, { type: 'add' })).toBe(adding)
    expect(musicCardTransition(adding, { type: 'generate' })).toBe(adding)
    const failed = musicCardTransition(adding, { type: 'add-failed', error: 'offline' })
    expect(failed.phase).toBe('ready')
    expect(failed.music).toBe(track)
    expect(failed.error).toBe('offline')
    expect(canAdd(failed)).toBe(true)
  })

  test('add is refused before a track lands', () => {
    expect(musicCardTransition(generating, { type: 'add' })).toBe(generating)
  })
})

describe('musicCardTransition lyrics', () => {
  test('one lookup at a time, from ready only', () => {
    const loading = musicCardTransition(ready, { type: 'lyrics-start' })
    expect(musicLyricsBusy(loading)).toBe(true)
    expect(canFindLyrics(loading)).toBe(false)
    expect(musicCardTransition(loading, { type: 'lyrics-start' })).toBe(loading)
    expect(musicCardTransition(generating, { type: 'lyrics-start' })).toBe(generating)
  })

  test('a finished lookup clears the busy state and can carry a note', () => {
    const loading = musicCardTransition(ready, { type: 'lyrics-start' })
    expect(musicCardTransition(loading, { type: 'lyrics-done' })).toEqual({ ...loading, lyrics: 'idle' })
    const missing = musicCardTransition(loading, { type: 'lyrics-done', note: 'not found' })
    expect(missing.lyrics).toBe('idle')
    expect(missing.lyricsNote).toBe('not found')
  })
})

describe('musicCardTransition reset and edits', () => {
  test('link edits clear an error without dropping the ready track', () => {
    const failed = musicCardTransition(ready, { type: 'add' })
    const offline = musicCardTransition(failed, { type: 'add-failed', error: 'offline' })
    const edited = musicCardTransition(offline, { type: 'link-edited' })
    expect(edited.error).toBeNull()
    expect(edited.music).toBe(track)
  })

  test('reset returns the initial flow and is idempotent', () => {
    expect(musicCardTransition(ready, { type: 'reset' })).toBe(MUSIC_CARD_FLOW)
    expect(musicCardTransition(MUSIC_CARD_FLOW, { type: 'reset' })).toBe(MUSIC_CARD_FLOW)
  })
})
