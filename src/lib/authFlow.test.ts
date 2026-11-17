import { describe, expect, test } from 'bun:test'

import { AUTH_IDLE, authTransition } from './authFlow'

const signingIn = authTransition(AUTH_IDLE, { type: 'submit' })
const signedIn = authTransition(signingIn, { type: 'resolved', email: 'a@b.c' })
const error = authTransition(signingIn, { type: 'failed', message: 'Wrong password' })

describe('authFlow', () => {
  test('idle submits, resolves, and fails', () => {
    expect(signingIn).toEqual({ phase: 'signingIn' })
    expect(authTransition(signingIn, { type: 'resolved', email: 'a@b.c' })).toEqual({ phase: 'signedIn', email: 'a@b.c' })
    expect(authTransition(signingIn, { type: 'failed', message: 'Wrong password' })).toEqual({ phase: 'error', message: 'Wrong password' })
  })

  test('signedIn is terminal for the form', () => {
    expect(authTransition(signedIn, { type: 'submit' })).toBe(signedIn)
    expect(authTransition(signedIn, { type: 'resolved', email: 'x@y.z' })).toBe(signedIn)
    expect(authTransition(signedIn, { type: 'failed', message: 'no' })).toBe(signedIn)
    expect(authTransition(signedIn, { type: 'dismissed' })).toBe(signedIn)
  })

  test('error re-submits and dismisses back to idle', () => {
    expect(authTransition(error, { type: 'submit' })).toEqual({ phase: 'signingIn' })
    expect(authTransition(error, { type: 'dismissed' })).toEqual({ phase: 'idle' })
    expect(authTransition(error, { type: 'resolved', email: 'x@y.z' })).toBe(error)
    expect(authTransition(error, { type: 'failed', message: 'no' })).toBe(error)
  })

  test('signingIn refuses every other event', () => {
    expect(authTransition(signingIn, { type: 'submit' })).toBe(signingIn)
    expect(authTransition(signingIn, { type: 'dismissed' })).toBe(signingIn)
  })

  test('idle never jumps to signedIn without a resolved session', () => {
    expect(authTransition(AUTH_IDLE, { type: 'resolved', email: 'a@b.c' })).toBe(AUTH_IDLE)
    expect(authTransition(AUTH_IDLE, { type: 'dismissed' })).toBe(AUTH_IDLE)
  })

  test('the transition is pure: the same fold repeats', () => {
    expect(authTransition(AUTH_IDLE, { type: 'submit' })).toEqual(signingIn)
    expect(authTransition(signingIn, { type: 'failed', message: 'Wrong password' })).toEqual(error)
  })
})
