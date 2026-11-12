/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { isTransformersModule } from './bgRemoval.worker'

/**
 * The vendored bundle's shape at the depth the guard checks it: every binding
 * the worker destructures, plus the `env.backends.onnx` path `createRemover`
 * reads. The classes carry the statics as own properties, as the real ones do.
 */
function fakeModule(): Record<string, unknown> {
  class FakeAutoModel {
    static from_pretrained() {}
  }
  class FakeRawImage {
    static fromBlob() {}
  }
  class FakeTensor {}
  return {
    AutoModel: FakeAutoModel,
    env: { backends: { onnx: {} } },
    RawImage: FakeRawImage,
    Tensor: FakeTensor,
  }
}

/** The fake with one property deleted, so a rejection points at one binding. */
function without(key: string, prop?: string) {
  const mod = fakeModule()
  if (prop === undefined) {
    delete mod[key]
  }
  else {
    const member = mod[key] as Record<string, unknown>
    delete member[prop]
  }
  return mod
}

describe('isTransformersModule', () => {
  test('accepts a bundle with every export the worker uses', () => {
    expect(isTransformersModule(fakeModule())).toBe(true)
  })

  test('rejects anything that is not the module', () => {
    expect(isTransformersModule(undefined)).toBe(false)
    expect(isTransformersModule('transformers')).toBe(false)
    expect(isTransformersModule(() => {})).toBe(false)
  })

  test('rejects a bundle that lost a binding the worker destructures', () => {
    expect(isTransformersModule(without('Tensor'))).toBe(false)
    expect(isTransformersModule(without('AutoModel'))).toBe(false)
    expect(isTransformersModule(without('RawImage'))).toBe(false)
    expect(isTransformersModule(without('env'))).toBe(false)
  })

  test('rejects a binding that lost the member the worker calls', () => {
    expect(isTransformersModule(without('AutoModel', 'from_pretrained'))).toBe(false)
    expect(isTransformersModule(without('RawImage', 'fromBlob'))).toBe(false)
  })

  test('rejects an env without the onnx backend path createRemover reads', () => {
    expect(isTransformersModule(without('env', 'backends'))).toBe(false)
    expect(isTransformersModule({ ...fakeModule(), env: { backends: {} } })).toBe(false)
  })
})
