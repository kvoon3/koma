import type { RefObject } from 'react'
import type { CameraErrorCode, CameraSession } from '../../lib/camera'
import type { TKey } from '../../lib/locales/zh-Hans'
import { Camera } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useRef, useState } from 'react'
import { cameraSupport, classifyCameraFailure, openCamera } from '../../lib/camera'
import { useT } from '../../lib/i18n'
import { Button } from '../ui/button'

type CameraUiState
  = | { status: 'starting' }
    | { status: 'ready' }
    | { status: 'capturing' }
    | { status: 'error', code: CameraErrorCode }

const ERROR_KEY: Record<CameraErrorCode, TKey> = {
  'denied': 'Camera access was denied. Allow camera access in the browser, then try again.',
  'no-device': 'No camera was found on this device.',
  'insecure': 'The camera needs a secure connection (HTTPS).',
  'unsupported': 'This browser cannot take photos.',
  'busy': 'The camera is in use by another app.',
  'generic': 'The camera could not be used.',
}

const RETRYABLE: readonly CameraErrorCode[] = ['denied', 'no-device', 'busy', 'generic']

/**
 * Owns the mounted session. The effect's cleanup is the stream's release
 * point; `attempt` is the Retry key. A getUserMedia promise that resolves after
 * unmount is stopped immediately and its state update is dropped.
 */
function useCameraPreview(videoRef: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<CameraUiState>({ status: 'starting' })
  const [attempt, setAttempt] = useState(0)
  const sessionRef = useRef<CameraSession | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    let alive = true
    aliveRef.current = true
    let session: CameraSession | null = null

    const support = cameraSupport()
    if (support !== 'ready') {
      setState({ status: 'error', code: support })
      return () => {
        alive = false
        aliveRef.current = false
      }
    }

    void (async () => {
      try {
        session = await openCamera()
        if (!alive) {
          session.stop()
          return
        }
        sessionRef.current = session
        const video = videoRef.current
        if (!video) {
          session.stop()
          sessionRef.current = null
          return
        }
        await session.attach(video)
        if (alive)
          setState({ status: 'ready' })
      }
      catch (error) {
        session?.stop()
        if (sessionRef.current === session)
          sessionRef.current = null
        if (alive)
          setState({ status: 'error', code: classifyCameraFailure(error) })
      }
    })()

    return () => {
      alive = false
      aliveRef.current = false
      session?.stop()
      if (sessionRef.current === session)
        sessionRef.current = null
    }
  }, [attempt, videoRef])

  const retry = () => {
    setState({ status: 'starting' })
    setAttempt(value => value + 1)
  }

  const capture = async (): Promise<File | null> => {
    const session = sessionRef.current
    if (!aliveRef.current || !session || state.status !== 'ready')
      return null
    setState({ status: 'capturing' })
    try {
      const file = await session.capture()
      return aliveRef.current ? file : null
    }
    catch (error) {
      if (aliveRef.current)
        setState({ status: 'error', code: classifyCameraFailure(error) })
      return null
    }
  }

  return { state, retry, capture }
}

/**
 * The camera stage slot. It stands in for the stage the way LibraryPickPanel
 * does, owns exactly one stream for its lifetime, and hands the captured File
 * to the maker's existing pick door.
 */
export function CameraCapturePanel({ onCapture, onCancel }: {
  onCapture: (file: File) => void
  onCancel: () => void
}) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { state, retry, capture } = useCameraPreview(videoRef)
  const [captureFailed, setCaptureFailed] = useState(false)

  const errorCode = state.status === 'error' ? state.code : null
  const retryable = errorCode != null && RETRYABLE.includes(errorCode)

  const takePhoto = async () => {
    setCaptureFailed(false)
    const file = await capture()
    if (file)
      onCapture(file)
    else
      setCaptureFailed(true)
  }

  const tryAgain = () => {
    setCaptureFailed(false)
    retry()
  }

  return (
    <div
      className="stage-clear relative flex h-[220px] shrink-0 flex-col overflow-hidden border border-line-strong"
      data-camera-panel=""
      data-camera-state={state.status}
    >
      <div className="flex flex-none items-center gap-2 border-b border-line-strong bg-panel px-2 py-1">
        <MorphIcon icon={Camera} size={13} strokeWidth={1.75} className="flex-none text-dim" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-txt">{t('Take a photo')}</span>
      </div>

      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          muted
          autoPlay
          playsInline
          data-camera-preview=""
          aria-label={t('Camera preview')}
        />

        {state.status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <span className="text-[12px] font-semibold text-white">{t('Starting the camera…')}</span>
          </div>
        )}

        {errorCode && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel/95 px-4 text-center"
            data-camera-error={errorCode}
          >
            <span className="text-[12px] leading-[1.4] text-txt">{t(ERROR_KEY[errorCode])}</span>
            {captureFailed && <span className="text-[11px] text-dim">{t('Could not take the photo.')}</span>}
            {retryable && (
              <Button variant="flat" data-camera-retry="" onClick={tryAgain}>{t('Retry')}</Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-none items-center justify-end gap-[6px] border-t border-line-strong bg-panel px-2 py-1.5">
        <Button variant="flat" data-camera-cancel="" onClick={onCancel}>{t('Cancel')}</Button>
        <Button variant="strong" data-camera-capture="" disabled={state.status !== 'ready'} onClick={takePhoto}>
          {t('Use photo')}
        </Button>
      </div>
    </div>
  )
}
