/// <reference lib="webworker" />

import type { RawImage as RawImageType } from '@huggingface/transformers'

type TransformersModule = typeof import('@huggingface/transformers')

interface RemoveRequest {
  id: number
  type: 'remove'
  image: ArrayBuffer
  mimeType: string
  /** Absolute URL of the directory that holds the model files. */
  modelBaseUrl: string
  /** Absolute URL of the directory that holds the transformers.js and onnxruntime files. */
  vendorBaseUrl: string
}

interface ProgressEvent {
  status?: string
  progress?: number
  loaded?: number
  total?: number
  file?: string
}

/** What one output tensor must carry for the matte pass. */
interface ModelTensor {
  data: Float32Array | Uint8Array
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isModelTensor(value: unknown): value is ModelTensor {
  if (!isRecord(value))
    return false
  const { data } = value
  return data instanceof Float32Array || data instanceof Uint8Array
}

function isModelOutput(value: unknown): value is Record<string, ModelTensor> {
  return isRecord(value) && Object.values(value).every(isModelTensor)
}

const MODEL_ID = 'BritishWerewolf/U-2-Netp'

let transformersPromise: Promise<TransformersModule> | null = null

/**
 * The vendored bundle carries no static module type, so the dynamic import
 * arrives as `unknown`. This guard proves every binding the worker
 * destructures and the `env.backends.onnx` path `createRemover` reads, so a
 * bundle that lost or renamed an export fails here with one message instead of
 * deep inside the pixel loops. The `wasm` member inside that path keeps its
 * own check in `createRemover`.
 */
export function isTransformersModule(value: unknown): value is TransformersModule {
  if (!isRecord(value))
    return false
  const { AutoModel, env, RawImage, Tensor } = value
  return typeof AutoModel === 'function'
    && 'from_pretrained' in AutoModel
    && isRecord(env)
    && isRecord(env.backends)
    && isRecord(env.backends.onnx)
    && typeof RawImage === 'function'
    && 'fromBlob' in RawImage
    && typeof Tensor === 'function'
}

async function loadTransformers(vendorBaseUrl: string): Promise<TransformersModule> {
  transformersPromise ??= (async () => {
    const mod: unknown = await import(/* @vite-ignore */ `${vendorBaseUrl}transformers.min.js`)
    if (!isTransformersModule(mod))
      throw new Error('the vendored transformers bundle is missing the exports this worker uses')
    return mod
  })()
  return transformersPromise
}

// U²-Net intentionally returns a soft matte, but its low-confidence tail often
// contains the original floor/wall color. Leaving that tail intact makes those
// pixels render above the sticker outline as a gray halo. Compress the tail
// while preserving a feathered transition around hair and fur.
const MATTE_BLACK_POINT = 0.12
const MATTE_WHITE_POINT = 0.78

let removerPromise: Promise<Awaited<ReturnType<typeof createRemover>>> | null = null

function cleanMatteAlpha(value: number) {
  const normalized = Math.max(0, Math.min(1, value / 255))
  const clipped = Math.max(
    0,
    Math.min(
      1,
      (normalized - MATTE_BLACK_POINT) / (MATTE_WHITE_POINT - MATTE_BLACK_POINT),
    ),
  )
  return clipped * clipped * (3 - 2 * clipped)
}

function postProgress(id: number, phase: 'loading' | 'processing', progress?: number) {
  globalThis.postMessage({ type: 'progress', id, phase, progress })
}

async function createRemover(id: number, modelBaseUrl: string, vendorBaseUrl: string) {
  const { AutoModel, env, RawImage, Tensor } = await loadTransformers(vendorBaseUrl)

  // The package types `pad` and `crop` as `Promise<any>`; check the runtime
  // class once here instead of letting `any` spread through the pixel loops.
  const padImage = async (image: RawImageType, padding: [number, number, number, number]): Promise<RawImageType> => {
    const padded: unknown = await image.pad(padding)
    if (!(padded instanceof RawImage))
      throw new Error('transformers pad returned no image')
    return padded
  }
  const cropImage = async (image: RawImageType, box: [number, number, number, number]): Promise<RawImageType> => {
    const cropped: unknown = await image.crop(box)
    if (!(cropped instanceof RawImage))
      throw new Error('transformers crop returned no image')
    return cropped
  }
  // Serve model files from the same origin so background removal works where
  // the Hugging Face Hub is unavailable. The path has to arrive absolute: the
  // bundled worker runs from a blob:/data: URL, which cannot resolve a
  // root-relative fetch, so `env.localModelPath = '/models/'` fails to parse.
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.localModelPath = modelBaseUrl
  const wasm = env.backends.onnx.wasm
  if (!isRecord(wasm))
    throw new Error('the ONNX WASM backend is unavailable')
  wasm.wasmPaths = {
    mjs: `${vendorBaseUrl}ort-wasm-simd-threaded.mjs`,
    wasm: `${vendorBaseUrl}ort-wasm-simd-threaded.wasm`,
  }

  const progressCallback = (event: ProgressEvent) => {
    if (event.status === 'ready') {
      postProgress(id, 'loading', 100)
      return
    }
    const progress = Number(event.progress)
    if (Number.isFinite(progress))
      postProgress(id, 'loading', Math.max(0, Math.min(100, progress)))
  }

  const model = await AutoModel.from_pretrained(MODEL_ID, {
    device: 'wasm',
    dtype: 'fp32',
    progress_callback: progressCallback,
  })
  postProgress(id, 'loading', 100)

  return async (input: Blob) => {
    const image = await RawImage.fromBlob(input)
    const inputSize = 320
    const scale = Math.min(inputSize / image.width, inputSize / image.height)
    const resizedWidth = Math.max(1, Math.round(image.width * scale))
    const resizedHeight = Math.max(1, Math.round(image.height * scale))
    const left = Math.floor((inputSize - resizedWidth) / 2)
    const right = inputSize - resizedWidth - left
    const top = Math.floor((inputSize - resizedHeight) / 2)
    const bottom = inputSize - resizedHeight - top
    const resized = await image.clone().rgb().resize(resizedWidth, resizedHeight)
    const prepared = await padImage(resized, [left, right, top, bottom])

    const mean = [0.485, 0.456, 0.406]
    const standardDeviation = [0.229, 0.224, 0.225]
    const planeSize = inputSize * inputSize
    const normalized = new Float32Array(planeSize * 3)
    for (let channel = 0; channel < 3; channel += 1) {
      const channelMean = mean[channel]
      const channelDeviation = standardDeviation[channel]
      if (channelMean === undefined || channelDeviation === undefined)
        continue
      for (let pixel = 0; pixel < planeSize; pixel += 1) {
        const value = prepared.data[pixel * 3 + channel]
        if (value === undefined)
          continue
        normalized[channel * planeSize + pixel] = (value / 255 - channelMean) / channelDeviation
      }
    }
    const pixelValues = new Tensor('float32', normalized, [1, 3, inputSize, inputSize])
    const rawPrediction: unknown = await model({ 'input.1': pixelValues })
    if (!isModelOutput(rawPrediction))
      throw new Error('The model returned no output tensors')
    const prediction = rawPrediction
    const composite = prediction['1959'] ?? Object.values(prediction)[0]
    if (!composite)
      throw new Error('The model returned no foreground mask')
    let minimum = Number.POSITIVE_INFINITY
    let maximum = Number.NEGATIVE_INFINITY
    for (const value of composite.data) {
      minimum = Math.min(minimum, Number(value))
      maximum = Math.max(maximum, Number(value))
    }
    const range = Math.max(maximum - minimum, 0.00001)
    const maskPixels = new Uint8Array(inputSize * inputSize)
    for (let index = 0; index < maskPixels.length; index += 1) {
      maskPixels[index] = Math.round(((Number(composite.data[index]) - minimum) / range) * 255)
    }
    const paddedMask = new RawImage(maskPixels, inputSize, inputSize, 1)
    const croppedMask = await cropImage(paddedMask, [
      left,
      top,
      left + resizedWidth - 1,
      top + resizedHeight - 1,
    ])
    const mask = await croppedMask.resize(image.width, image.height)
    image.rgba()
    for (let index = 0; index < mask.data.length; index += 1) {
      const sourcePixel = image.data[index * 4 + 3]
      const maskValue = mask.data[index]
      if (sourcePixel === undefined || maskValue === undefined)
        continue
      const cleanedAlpha = cleanMatteAlpha(maskValue)
      const sourceAlpha = sourcePixel / 255
      mask.data[index] = Math.round(cleanedAlpha * sourceAlpha * 255)
    }
    return image.putAlpha(mask)
  }
}

async function handleMessage(event: MessageEvent<RemoveRequest>) {
  const request = event.data
  if (request.type !== 'remove')
    return

  try {
    postProgress(request.id, 'loading', 0)
    removerPromise ??= createRemover(request.id, request.modelBaseUrl, request.vendorBaseUrl)
    const remover = await removerPromise
    postProgress(request.id, 'processing')

    const input = new Blob([request.image], { type: request.mimeType })
    const output = await remover(input)
    const pixels = new Uint8ClampedArray(output.data)
    globalThis.postMessage(
      {
        type: 'result',
        id: request.id,
        pixels: pixels.buffer,
        width: output.width,
        height: output.height,
      },
      { transfer: [pixels.buffer] },
    )
  }
  catch (error) {
    transformersPromise = null
    removerPromise = null
    globalThis.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Background removal failed',
    })
  }
}

globalThis.addEventListener('message', (event: MessageEvent<RemoveRequest>) => {
  void handleMessage(event)
})

export {}
