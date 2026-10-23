/**
 * The browser camera protocol behind one opener and one session handle. The UI
 * never sees a DOMException name, a constraint object or a MediaStream: it sees
 * a support value, an error code, and three methods whose lifetime it owns.
 */

export type CameraSupport = 'ready' | 'insecure' | 'unsupported'

/** The pieces of the environment the decision needs; structural so tests can pass plain objects. */
export interface CameraScope {
  readonly isSecureContext?: boolean
  readonly mediaDevices?: { readonly getUserMedia?: unknown } | null
}

/**
 * Detection order matters: insecure first, so a phone on `http://192.168.x.x`
 * sees the HTTPS message rather than "browser not supported" (in an insecure
 * context the mediaDevices object is often absent, which is ambiguous).
 */
export function cameraSupportOf(scope: CameraScope): CameraSupport {
  if (scope.isSecureContext === false)
    return 'insecure'
  if (typeof scope.mediaDevices?.getUserMedia !== 'function')
    return 'unsupported'
  return 'ready'
}

/** The browser's own environment. Safe to call under Bun: no module-level navigator access. */
export function cameraSupport(): CameraSupport {
  if (typeof navigator === 'undefined')
    return 'unsupported'
  return cameraSupportOf({
    isSecureContext: typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : undefined,
    mediaDevices: navigator.mediaDevices ?? null,
  })
}

export type CameraErrorCode
  = | 'denied'
    | 'no-device'
    | 'insecure'
    | 'unsupported'
    | 'busy'
    | 'generic'

export class CameraError extends Error {
  readonly code: CameraErrorCode

  constructor(code: CameraErrorCode, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'CameraError'
    this.code = code
  }
}

/**
 * DOMException names -> the failure causes the UI has copy for. Busy is its own
 * code because "in use by another app" tells the user what to change; AbortError
 * and unknown names stay generic.
 */
const FAILURE_CODES: Record<string, CameraErrorCode> = {
  NotAllowedError: 'denied',
  PermissionDeniedError: 'denied',
  NotFoundError: 'no-device',
  DevicesNotFoundError: 'no-device',
  OverconstrainedError: 'no-device',
  ConstraintNotSatisfiedError: 'no-device',
  SecurityError: 'insecure',
  NotSupportedError: 'unsupported',
  NotReadableError: 'busy',
  TrackStartError: 'busy',
}

export function classifyCameraFailure(error: unknown): CameraErrorCode {
  if (error instanceof CameraError)
    return error.code
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && Object.hasOwn(FAILURE_CODES, name))
      return FAILURE_CODES[name]!
  }
  return 'generic'
}

export interface CameraSession {
  /** Attach the stream and resolve when a frame is drawable. */
  attach: (video: HTMLVideoElement) => Promise<void>
  /** One JPEG File from the current frame; stops the session in a finally, on success or failure. */
  capture: () => Promise<File>
  /**
   * Idempotent: stops every track and detaches the element. Safe before attach
   * resolves; an attach that races a stop leaves the element detached.
   */
  stop: () => void
}

const ATTACH_TIMEOUT_MS = 10_000
const CAPTURE_MAX_EDGE = 1600
const CAPTURE_JPEG_QUALITY = 0.92

function createSession(stream: MediaStream): CameraSession {
  let video: HTMLVideoElement | null = null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelAttach: (() => void) | null = null

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const detach = () => {
    if (video && video.srcObject === stream)
      video.srcObject = null
    video = null
  }

  const stop = () => {
    if (stopped)
      return
    stopped = true
    clearTimer()
    detach()
    const cancel = cancelAttach
    cancelAttach = null
    cancel?.()
    for (const track of stream.getTracks())
      track.stop()
  }

  const attach = async (element: HTMLVideoElement) => {
    if (stopped)
      throw new CameraError('generic')
    video = element
    element.srcObject = stream

    // `loadeddata` is the first frame, not just the dimensions: capture reads
    // the live frame and refuses a video that cannot supply one.
    if (element.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        function settle(error?: CameraError) {
          if (settled)
            return
          settled = true
          clearTimer()
          element.removeEventListener('loadeddata', onLoaded)
          element.removeEventListener('error', onError)
          cancelAttach = null
          if (error)
            reject(error)
          else
            resolve()
        }
        function onLoaded() {
          settle()
        }
        function onError() {
          settle(new CameraError('generic'))
        }
        cancelAttach = () => settle(new CameraError('generic'))
        element.addEventListener('loadeddata', onLoaded)
        element.addEventListener('error', onError)
        timer = setTimeout(() => settle(new CameraError('generic')), ATTACH_TIMEOUT_MS)
      })
    }

    if (stopped)
      return
    // A refused play leaves no frame to capture, so it is a failure rather
    // than a silently enabled Use photo button.
    try {
      await element.play()
    }
    catch {
      throw new CameraError('generic')
    }
  }

  const capture = async (): Promise<File> => {
    try {
      if (stopped || !video || video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < 2)
        throw new CameraError('generic')
      const longEdge = Math.max(video.videoWidth, video.videoHeight)
      const scale = Math.min(1, CAPTURE_MAX_EDGE / longEdge)
      const width = Math.max(1, Math.round(video.videoWidth * scale))
      const height = Math.max(1, Math.round(video.videoHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context)
        throw new CameraError('generic')
      context.drawImage(video, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', CAPTURE_JPEG_QUALITY)
      })
      if (!blob)
        throw new CameraError('generic')
      return new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
    }
    finally {
      stop()
    }
  }

  return { attach, capture, stop }
}

/**
 * The environment-facing stream (`ideal`, so a laptop with one front camera
 * still opens) or the error that stopped it. Support is checked first, so an
 * absent API never becomes a TypeError.
 */
export async function openCamera(): Promise<CameraSession> {
  const support = cameraSupport()
  if (support !== 'ready')
    throw new CameraError(support)

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1920 },
      },
      audio: false,
    })
  }
  catch (error) {
    throw new CameraError(classifyCameraFailure(error), { cause: error })
  }

  if (!stream.getVideoTracks().some(track => track.readyState === 'live')) {
    for (const track of stream.getTracks())
      track.stop()
    throw new CameraError('no-device')
  }
  return createSession(stream)
}
