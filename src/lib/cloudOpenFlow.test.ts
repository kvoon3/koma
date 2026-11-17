/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { CLOUD_OPEN_IDLE, cloudOpenTransition } from './cloudOpenFlow'

const projects = [{ id: 'p1', name: 'Session', createdAt: 'a', updatedAt: 'b' }]
const loading = cloudOpenTransition(CLOUD_OPEN_IDLE, { type: 'open' })

describe('cloudOpenTransition', () => {
  test('opening fetches, then the list or an error lands', () => {
    expect(loading).toEqual({ phase: 'loading' })
    expect(cloudOpenTransition(loading, { type: 'loaded', projects })).toEqual({ phase: 'ready', projects })
    expect(cloudOpenTransition(loading, { type: 'failed', message: 'offline' })).toEqual({ phase: 'error', message: 'offline' })
  })

  test('a retry starts from error, a stale result is refused', () => {
    const failed = cloudOpenTransition(loading, { type: 'failed', message: 'offline' })
    expect(cloudOpenTransition(failed, { type: 'open' })).toEqual(loading)
    expect(cloudOpenTransition(CLOUD_OPEN_IDLE, { type: 'loaded', projects })).toBe(CLOUD_OPEN_IDLE)
    expect(cloudOpenTransition(failed, { type: 'loaded', projects })).toBe(failed)
  })

  test('closing drops the list from any phase', () => {
    expect(cloudOpenTransition(cloudOpenTransition(loading, { type: 'loaded', projects }), { type: 'close' })).toEqual(CLOUD_OPEN_IDLE)
    expect(cloudOpenTransition(loading, { type: 'close' })).toEqual(CLOUD_OPEN_IDLE)
  })
})
