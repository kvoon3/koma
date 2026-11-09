/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { canSaveSticker, initialStickerMaker, makerImageStage, stickerMakerTransition } from './stickerMakerFlow'

const image = initialStickerMaker('image')

describe('stickerMakerTransition', () => {
  test('a panel opens from the bare stage only, one at a time', () => {
    const camera = stickerMakerTransition(image, { type: 'panel', panel: 'camera' })
    expect(camera.panel).toBe('camera')
    expect(stickerMakerTransition(camera, { type: 'panel', panel: 'library' })).toBe(camera)
    expect(stickerMakerTransition(camera, { type: 'stage' }).panel).toBe('stage')
  })

  test('the text tab has no source doors', () => {
    const text = stickerMakerTransition(image, { type: 'tab', tab: 'text' })
    expect(stickerMakerTransition(text, { type: 'panel', panel: 'camera' })).toBe(text)
  })

  test('a tab change closes the open panel', () => {
    const camera = stickerMakerTransition(image, { type: 'panel', panel: 'camera' })
    const text = stickerMakerTransition(camera, { type: 'tab', tab: 'text' })
    expect(text).toEqual({ tab: 'text', panel: 'stage', saving: false })
    expect(stickerMakerTransition(text, { type: 'tab', tab: 'text' })).toBe(text)
  })

  test('save is a single flight that only starts on the bare stage', () => {
    const camera = stickerMakerTransition(image, { type: 'panel', panel: 'camera' })
    expect(stickerMakerTransition(camera, { type: 'save-start' })).toBe(camera)
    const saving = stickerMakerTransition(image, { type: 'save-start' })
    expect(saving.saving).toBe(true)
    expect(stickerMakerTransition(saving, { type: 'save-start' })).toBe(saving)
    expect(stickerMakerTransition(saving, { type: 'save-settle' }).saving).toBe(false)
  })

  test('closing resets the panel and the save flag but keeps the tab', () => {
    const saving = stickerMakerTransition(stickerMakerTransition(image, { type: 'tab', tab: 'text' }), { type: 'save-start' })
    expect(stickerMakerTransition(saving, { type: 'close' })).toEqual({ tab: 'text', panel: 'stage', saving: false })
    expect(stickerMakerTransition(image, { type: 'close' })).toBe(image)
  })
})

describe('canSaveSticker', () => {
  const base = { flow: image, hasSource: true, hasTarget: true, cutting: false }
  test('needs a subject and a destination', () => {
    expect(canSaveSticker(base)).toBe(true)
    expect(canSaveSticker({ ...base, hasSource: false })).toBe(false)
    expect(canSaveSticker({ ...base, hasTarget: false })).toBe(false)
  })
  test('refuses while cutting, saving, or behind a panel', () => {
    expect(canSaveSticker({ ...base, cutting: true })).toBe(false)
    const saving = stickerMakerTransition(image, { type: 'save-start' })
    expect(canSaveSticker({ ...base, flow: saving })).toBe(false)
    for (const panel of ['camera', 'library', 'mask'] as const) {
      const flow = stickerMakerTransition(image, { type: 'panel', panel })
      expect(canSaveSticker({ ...base, flow })).toBe(false)
    }
  })
})

describe('makerImageStage', () => {
  test('empty, cutting, ready', () => {
    expect(makerImageStage(false, false)).toBe('empty')
    expect(makerImageStage(true, true)).toBe('cuttingOut')
    expect(makerImageStage(true, false)).toBe('ready')
  })
})
