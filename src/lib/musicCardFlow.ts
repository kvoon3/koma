import type { ResolvedMusic } from './musicLink'

/**
 * The music card dialog's async state. It was five correlated flags
 * (`resolving`, `adding`, `music`, `error`, `lyricsBusy`), which allowed a
 * real impossible state: while a new link was resolving, the previous track's
 * preview stayed on screen and Add stayed enabled, so a tap saved the OLD
 * card under the NEW link. The phases make that unreachable:
 *
 *   idle -> resolving -> ready -> adding (-> the dialog closes)
 *                \-> idle (failure)     \-> ready (add failure)
 *
 * `music` survives `resolving` because the preview is worth keeping while the
 * next track loads; it is `canAdd`'s job to ignore it until the resolve lands.
 * Lyrics lookup is a small inner state, only reachable from `ready`.
 */
export type MusicCardPhase = 'idle' | 'resolving' | 'ready' | 'adding'
export type LyricsPhase = 'idle' | 'loading'

export interface MusicCardFlow {
  phase: MusicCardPhase
  /** The last resolved track. Kept while the next link resolves; `canAdd` is false then. */
  music: ResolvedMusic | null
  /** The last resolve or add failure, already translated. Cleared by the next action. */
  error: string | null
  lyrics: LyricsPhase
  /** The note under the lyric list: nothing found, unreachable, or null. */
  lyricsNote: string | null
}

export type MusicCardEvent
  = | { type: 'generate' }
    | { type: 'resolved', music: ResolvedMusic }
    | { type: 'resolve-failed', error: string }
    | { type: 'add' }
    | { type: 'add-failed', error: string }
    | { type: 'lyrics-start' }
    | { type: 'lyrics-done', note?: string | null }
    | { type: 'link-edited' }
    | { type: 'error', error: string }
    | { type: 'reset' }

export const MUSIC_CARD_FLOW: MusicCardFlow = {
  phase: 'idle',
  music: null,
  error: null,
  lyrics: 'idle',
  lyricsNote: null,
}

function startResolve(state: MusicCardFlow): MusicCardFlow {
  // A new resolve also starts the lyrics over: the words belong to the track,
  // and the old ones would render against the new title.
  return canGenerate(state)
    ? { ...state, phase: 'resolving', error: null, lyrics: 'idle', lyricsNote: null }
    : state
}

function landResolve(state: MusicCardFlow, music: ResolvedMusic): MusicCardFlow {
  return state.phase === 'resolving'
    ? { phase: 'ready', music, error: null, lyrics: 'idle', lyricsNote: null }
    : state
}

function failResolve(state: MusicCardFlow, error: string): MusicCardFlow {
  return state.phase === 'resolving'
    ? { phase: 'idle', music: null, error, lyrics: 'idle', lyricsNote: null }
    : state
}

function startAdd(state: MusicCardFlow): MusicCardFlow {
  return canAdd(state) ? { ...state, phase: 'adding', error: null } : state
}

function failAdd(state: MusicCardFlow, error: string): MusicCardFlow {
  return state.phase === 'adding' ? { ...state, phase: 'ready', error } : state
}

function startLyrics(state: MusicCardFlow): MusicCardFlow {
  return canFindLyrics(state) ? { ...state, lyrics: 'loading', lyricsNote: null } : state
}

function finishLyrics(state: MusicCardFlow, note?: string | null): MusicCardFlow {
  return state.lyrics === 'loading' ? { ...state, lyrics: 'idle', lyricsNote: note ?? null } : state
}

function clearError(state: MusicCardFlow): MusicCardFlow {
  return state.error ? { ...state, error: null } : state
}

function isInitial(state: MusicCardFlow): boolean {
  return state.phase === MUSIC_CARD_FLOW.phase
    && state.music === MUSIC_CARD_FLOW.music
    && state.error === MUSIC_CARD_FLOW.error
    && state.lyrics === MUSIC_CARD_FLOW.lyrics
    && state.lyricsNote === MUSIC_CARD_FLOW.lyricsNote
}

export function musicCardTransition(state: MusicCardFlow, event: MusicCardEvent): MusicCardFlow {
  switch (event.type) {
    case 'generate':
      return startResolve(state)
    case 'resolved':
      return landResolve(state, event.music)
    case 'resolve-failed':
      return failResolve(state, event.error)
    case 'add':
      return startAdd(state)
    case 'add-failed':
      return failAdd(state, event.error)
    case 'lyrics-start':
      return startLyrics(state)
    case 'lyrics-done':
      return finishLyrics(state, event.note)
    case 'link-edited':
      return clearError(state)
    case 'error':
      // A preview render can fail after the track landed; it is a note on the
      // current phase, not a transition.
      return { ...state, error: event.error }
    case 'reset':
      return isInitial(state) ? state : MUSIC_CARD_FLOW
  }
}

/** A new link may be resolved: not while one is in flight or a card is being written. */
export function canGenerate(state: MusicCardFlow): boolean {
  return state.phase === 'idle' || state.phase === 'ready'
}

/** Only a landed resolve is placeable; the old preview during a resolve is not. */
export function canAdd(state: MusicCardFlow): boolean {
  return state.phase === 'ready' && state.music != null
}

/** Lyrics belong to a resolved track; one lookup at a time. */
export function canFindLyrics(state: MusicCardFlow): boolean {
  return state.phase === 'ready' && state.music != null && state.lyrics === 'idle'
}

export function musicResolving(state: MusicCardFlow): boolean {
  return state.phase === 'resolving'
}

export function musicAdding(state: MusicCardFlow): boolean {
  return state.phase === 'adding'
}

export function musicLyricsBusy(state: MusicCardFlow): boolean {
  return state.lyrics === 'loading'
}
