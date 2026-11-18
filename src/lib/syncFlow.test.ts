/// <reference types="bun" />
import type { SyncFlowEvent, SyncFlowState } from './syncFlow'
import { describe, expect, test } from 'bun:test'
import { SYNC_IDLE, syncTransition } from './syncFlow'

const saving: SyncFlowState = { phase: 'saving' }
const saved: SyncFlowState = { phase: 'saved', projectId: 'p1', updatedAt: '2026-11-18 10:00:00' }
const conflict: SyncFlowState = { phase: 'conflict' }
const error: SyncFlowState = { phase: 'error', message: 'offline' }

describe('syncTransition', () => {
  test('idle -> saving -> saved carries the row the server returned', () => {
    const started = syncTransition(SYNC_IDLE, { type: 'save' })
    expect(started).toEqual(saving)
    expect(syncTransition(started, { type: 'saved', projectId: 'p1', updatedAt: '2026-11-18 10:00:00' })).toEqual(saved)
  })

  test('the saved state starts the next save', () => {
    expect(syncTransition(saved, { type: 'save' })).toEqual(saving)
  })

  test('a retry starts from error but never from conflict', () => {
    expect(syncTransition(error, { type: 'save' })).toEqual(saving)
    expect(syncTransition(conflict, { type: 'save' })).toBe(conflict)
  })

  test('a stale write reaches conflict, an unreachable server reaches error', () => {
    expect(syncTransition(saving, { type: 'conflict' })).toEqual(conflict)
    expect(syncTransition(saving, { type: 'failed', message: 'offline' })).toEqual(error)
  })

  test('outcomes are refused from any phase but saving', () => {
    for (const state of [SYNC_IDLE, saved, conflict, error]) {
      expect(syncTransition(state, { type: 'saved', projectId: 'p2', updatedAt: 'later' })).toBe(state)
      expect(syncTransition(state, { type: 'conflict' })).toBe(state)
      expect(syncTransition(state, { type: 'failed', message: 'x' })).toBe(state)
    }
  })

  test('dismiss clears a terminal state, and refuses conflict', () => {
    expect(syncTransition(saved, { type: 'dismissed' })).toEqual(SYNC_IDLE)
    expect(syncTransition(error, { type: 'dismissed' })).toEqual(SYNC_IDLE)
    expect(syncTransition(conflict, { type: 'dismissed' })).toBe(conflict)
    expect(syncTransition(SYNC_IDLE, { type: 'dismissed' })).toBe(SYNC_IDLE)
  })

  test('reset clears conflict and cancels an in-flight save so open can win', () => {
    expect(syncTransition(conflict, { type: 'reset' })).toEqual(SYNC_IDLE)
    expect(syncTransition(saved, { type: 'reset' })).toEqual(SYNC_IDLE)
    expect(syncTransition(error, { type: 'reset' })).toEqual(SYNC_IDLE)
    expect(syncTransition(saving, { type: 'reset' })).toEqual(SYNC_IDLE)
  })

  test('a save that finishes after reset does not re-enter saved', () => {
    const cancelled = syncTransition(saving, { type: 'reset' })
    expect(cancelled).toEqual(SYNC_IDLE)
    expect(syncTransition(cancelled, { type: 'saved', projectId: 'old', updatedAt: 't' })).toBe(cancelled)
    expect(syncTransition(cancelled, { type: 'failed', message: 'x' })).toBe(cancelled)
    expect(syncTransition(cancelled, { type: 'conflict' })).toBe(cancelled)
  })

  test('every phase is reachable and every event answers', () => {
    const events: SyncFlowEvent[] = [
      { type: 'save' },
      { type: 'saved', projectId: 'p', updatedAt: 't' },
      { type: 'conflict' },
      { type: 'failed', message: 'x' },
      { type: 'dismissed' },
      { type: 'reset' },
    ]
    const states: SyncFlowState[] = [SYNC_IDLE, saving, saved, conflict, error]
    for (const state of states) {
      for (const event of events)
        expect(syncTransition(state, event).phase).toBeString()
    }
  })
})
