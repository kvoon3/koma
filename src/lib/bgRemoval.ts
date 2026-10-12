// Local AI background removal, adapted from CatsJuice/sticker-forge (MIT)

import BgWorker from './bgRemoval.worker?worker&inline'

export interface BgRemovalProgress {
  phase: 'loading' | 'processing'
  progress?: number
}

interface WorkerProgressMessage {
  type: 'progress'
  id: number
  phase: BgRemovalProgress['phase']
  progress?: number
}

interface WorkerResultMessage {
  type: 'result'
  id: number
  pixels: ArrayBuffer
  width: number
  height: number
}

interface WorkerErrorMessage {
  type: 'error'
  id: number
  message: string
}

type WorkerResponse = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage

interface PendingRequest {
  resolve: (blob: Blob) => void
  reject: (error: Error) => void
  onProgress?: (progress: BgRemovalProgress) => void
}

const WORKER_IDLE_TIMEOUT = 60_000

let worker: Worker | null = null
let idleTimer: number | null = null
let requestId = 0
const pending = new Map<number, PendingRequest>()

function clearIdleTimer() {
  if (idleTimer === null)
    return
  window.clearTimeout(idleTimer)
  idleTimer = null
}

function scheduleIdleTermination() {
  clearIdleTimer()
  idleTimer = window.setTimeout(() => {
    idleTimer = null
    if (!worker || pending.size > 0)
      return
    worker.terminate()
    worker = null
  }, WORKER_IDLE_TIMEOUT)
}

function pixelsToBlob(pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
  return new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      reject(new Error('Canvas 2D is unavailable.'))
      return
    }
    context.putImageData(new ImageData(pixels, width, height), 0, 0)
    canvas.toBlob((blob) => {
      if (blob)
        resolve(blob)
      else
        reject(new Error('The cutout could not be encoded as a PNG.'))
    }, 'image/png')
  })
}

function rejectPending(error: Error) {
  const requests = [...pending.values()]
  pending.clear()
  for (const request of requests)
    request.reject(error)
}

function readWorkerResponse(created: Worker, response: WorkerResponse) {
  if (worker !== created)
    return
  const request = pending.get(response.id)
  if (!request)
    return
  if (response.type === 'progress') {
    request.onProgress?.({ phase: response.phase, progress: response.progress })
    return
  }
  pending.delete(response.id)
  if (response.type === 'error') {
    request.reject(new Error(response.message))
  }
  else {
    pixelsToBlob(new Uint8ClampedArray(response.pixels), response.width, response.height)
      .then(request.resolve, request.reject)
  }
  if (pending.size === 0)
    scheduleIdleTermination()
}

function getWorker() {
  if (worker)
    return worker
  const created = new BgWorker()
  created.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    readWorkerResponse(created, event.data)
  })
  created.addEventListener('error', () => {
    if (worker !== created) {
      created.terminate()
      return
    }
    worker = null
    created.terminate()
    clearIdleTimer()
    rejectPending(new Error('Background removal worker failed.'))
  })
  worker = created
  return created
}

/** Removes the background of an image with the local U²-Netᵖ model; resolves to a PNG blob. */
export async function removeBackground(
  blob: Blob,
  onProgress?: (p: BgRemovalProgress) => void,
): Promise<Blob> {
  const image = await blob.arrayBuffer()
  return new Promise<Blob>((resolve, reject) => {
    const id = ++requestId
    let target: Worker
    try {
      target = getWorker()
    }
    catch (error) {
      reject(error instanceof Error ? error : new Error('Background removal worker is unavailable.'))
      return
    }
    clearIdleTimer()
    pending.set(id, { resolve, reject, onProgress })
    try {
      target.postMessage({ type: 'remove', id, image, mimeType: blob.type || 'image/png' }, [image])
    }
    catch (error) {
      pending.delete(id)
      clearIdleTimer()
      target.terminate()
      if (worker === target)
        worker = null
      reject(error instanceof Error ? error : new Error('Could not start background removal.'))
    }
  })
}
