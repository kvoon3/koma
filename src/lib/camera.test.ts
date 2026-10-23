/// <reference types="bun" />
import type { CameraErrorCode } from './camera'
import { describe, expect, it } from 'bun:test'
import { CameraError, cameraSupportOf, classifyCameraFailure, openCamera } from './camera'

const mediaDevices = { getUserMedia() {} }

describe('camera support', () => {
  it('reports an insecure context before it reports a missing API', () => {
    expect(cameraSupportOf({ isSecureContext: false, mediaDevices })).toBe('insecure')
    expect(cameraSupportOf({ isSecureContext: false })).toBe('insecure')
  })

  it('reports unsupported when getUserMedia is absent', () => {
    expect(cameraSupportOf({ isSecureContext: true })).toBe('unsupported')
    expect(cameraSupportOf({ isSecureContext: true, mediaDevices: null })).toBe('unsupported')
    expect(cameraSupportOf({ isSecureContext: true, mediaDevices: {} })).toBe('unsupported')
  })

  it('is ready when the context is secure and the API is present', () => {
    expect(cameraSupportOf({ isSecureContext: true, mediaDevices })).toBe('ready')
  })
})

describe('camera failures', () => {
  it('maps every DOMException name the browser reports', () => {
    const cases: [string, CameraErrorCode][] = [
      ['NotAllowedError', 'denied'],
      ['PermissionDeniedError', 'denied'],
      ['NotFoundError', 'no-device'],
      ['DevicesNotFoundError', 'no-device'],
      ['OverconstrainedError', 'no-device'],
      ['ConstraintNotSatisfiedError', 'no-device'],
      ['SecurityError', 'insecure'],
      ['NotSupportedError', 'unsupported'],
      ['NotReadableError', 'busy'],
      ['TrackStartError', 'busy'],
    ]
    for (const [name, code] of cases)
      expect(classifyCameraFailure({ name })).toBe(code)
  })

  it('falls back to generic for abort and non-objects', () => {
    expect(classifyCameraFailure({ name: 'AbortError' })).toBe('generic')
    expect(classifyCameraFailure('NotAllowedError')).toBe('generic')
    expect(classifyCameraFailure(null)).toBe('generic')
    expect(classifyCameraFailure(undefined)).toBe('generic')
  })

  it('keeps a CameraError\'s own code', () => {
    expect(classifyCameraFailure(new CameraError('busy'))).toBe('busy')
  })
})

describe('opening without a camera API', () => {
  it('rejects with unsupported rather than a TypeError', async () => {
    let caught: unknown
    try {
      await openCamera()
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CameraError)
    expect((caught as CameraError).code).toBe('unsupported')
  })
})
