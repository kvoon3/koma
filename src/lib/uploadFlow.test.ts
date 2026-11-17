import { describe, expect, test } from 'bun:test'
import { UPLOAD_IDLE, uploadTransition } from './uploadFlow'

describe('uploadTransition', () => {
  test('idle starts, reports progress, and finishes', () => {
    const running = uploadTransition(UPLOAD_IDLE, { type: 'start', total: 3 })
    expect(running).toEqual({ phase: 'running', done: 0, total: 3 })
    const halfway = uploadTransition(running, { type: 'progress', done: 2 })
    expect(halfway).toEqual({ phase: 'running', done: 2, total: 3 })
    expect(uploadTransition(halfway, { type: 'finished', uploaded: 3 }))
      .toEqual({ phase: 'done', uploaded: 3 })
  })

  test('a failed run retries from failed', () => {
    const running = uploadTransition(UPLOAD_IDLE, { type: 'start', total: 2 })
    const failed = uploadTransition(running, { type: 'failed', message: 'offline' })
    expect(failed).toEqual({ phase: 'failed', message: 'offline' })
    expect(uploadTransition(failed, { type: 'start', total: 2 }))
      .toEqual({ phase: 'running', done: 0, total: 2 })
  })

  test('refuses a second start while running, stale progress, and a late finish', () => {
    const running = uploadTransition(UPLOAD_IDLE, { type: 'start', total: 4 })
    expect(uploadTransition(running, { type: 'start', total: 1 })).toBe(running)
    const atThree = uploadTransition(running, { type: 'progress', done: 3 })
    expect(uploadTransition(atThree, { type: 'progress', done: 1 })).toBe(atThree)
    expect(uploadTransition(atThree, { type: 'progress', done: 5 })).toBe(atThree)
    expect(uploadTransition(running, { type: 'finished', uploaded: 4 })).not.toBe(running)
    expect(uploadTransition(UPLOAD_IDLE, { type: 'finished', uploaded: 4 })).toBe(UPLOAD_IDLE)
    expect(uploadTransition(UPLOAD_IDLE, { type: 'failed', message: 'x' })).toBe(UPLOAD_IDLE)
  })

  test('dismissed returns the finished and failed runs to idle', () => {
    const done = uploadTransition(uploadTransition(UPLOAD_IDLE, { type: 'start', total: 1 }), { type: 'finished', uploaded: 1 })
    expect(uploadTransition(done, { type: 'dismissed' })).toEqual({ phase: 'idle' })
    const failed = uploadTransition(uploadTransition(UPLOAD_IDLE, { type: 'start', total: 1 }), { type: 'failed', message: 'x' })
    expect(uploadTransition(failed, { type: 'dismissed' })).toEqual({ phase: 'idle' })
  })
})
