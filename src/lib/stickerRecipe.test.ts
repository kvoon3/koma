/// <reference types="bun" />
import type { Photo } from './imageStore'
import type { StickerBakeStyle } from './stickerAssets'
import { beforeEach, describe, expect, it } from 'bun:test'
import { useStore } from '../store'
import { eraseStickerAsset } from './stickerAssets'
import { buildStickerRecipe, editedStickerMeta, normalizePhotoRecipes, recipeOf, stickerRecipeFrom, textOriginal } from './stickerRecipe'

/**
 * The re-edit record: the ORIGINAL a sticker was started from plus the style it
 * was saved with. The finished sticker is the other half of the pair and is the
 * record's own `file`, so there is no third thing to store.
 *
 * The bake (and the capture that encodes a picked File) is canvas work and is
 * measured in the browser (`makeSticker` cannot run under bun); here the
 * record's own lifecycle is pinned: built from the maker's inputs, attached to
 * the asset, carried forward through a re-save without re-encoding, round-tripped
 * through a session record, and read back, or dropped for a payload that is not
 * a complete record.
 */

const STYLE: StickerBakeStyle = {
  outlineWidth: 18,
  outlineColor: '#ffffff',
  material: 'holographic',
  baseName: 'cat',
  perforation: { depth: 4, spacing: 12 },
  displayLongEdge: 220,
  texture: null,
}

const ORIGINAL = { type: 'text' as const, text: 'hi', color: '#000000', fontId: 'system' }

function payload(style: unknown) {
  return { original: ORIGINAL, style }
}

/** A one-pixel PNG: enough to be a real file with a real signature. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wAAAABJRU5ErkJggg=='
const pngBytes = () => Uint8Array.from(atob(PNG_B64), c => c.charCodeAt(0))
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`

function photo(id: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    name: `${id}.png`,
    file: new File([pngBytes()], `${id}.png`, { type: 'image/png' }),
    trueW: 1,
    trueH: 1,
    ...extra,
  }
}

/** What IndexedDB hands back on the next load: the record without its File identity. */
function throughSession(record: Photo): Photo {
  const stored = structuredClone({ ...record, file: undefined })
  return { ...stored, file: record.file }
}

/**
 * The store this file writes: the photo list and the sticker folders. Reset per
 * test, so no test reads what the one before it left behind.
 */
const boot = useStore.getState()

beforeEach(() => {
  useStore.setState({ photos: boot.photos, stickerFolders: boot.stickerFolders })
})

describe('a made sticker\'s recipe', () => {
  it('is built from the maker\'s controls and survives a session record', async () => {
    const recipe = await buildStickerRecipe(
      { type: 'text', text: 'hi', color: '#000000', fontId: 'rounded' },
      STYLE,
    )
    expect(recipe).toEqual({ original: { type: 'text', text: 'hi', color: '#000000', fontId: 'rounded' }, style: STYLE })

    // The asset carries it, exactly as `addStickerAsset` leaves it.
    const made = photo('a', { kind: 'sticker', folder: 'Faces', recipe: recipe! })
    expect(recipeOf(made)).toEqual(recipe)
    expect(recipeOf(throughSession(made))).toEqual(recipe)
  })

  it('lands on the sticker record through the store, and on nothing else', async () => {
    const sticker = photo('s', { kind: 'sticker' })
    const plain = photo('p')
    useStore.setState({ photos: [sticker, plain] })

    const recipe = (await buildStickerRecipe(textOriginal('hi', '#000000', 'system'), STYLE))!
    useStore.getState().setStickerRecipe('s', recipe)

    const photos = useStore.getState().photos
    expect(recipeOf(photos.find(p => p.id === 's')!)).toEqual(recipe)
    // A photo is not a sticker: the marker stays absent on it.
    expect(photos.find(p => p.id === 'p')!.recipe).toBeUndefined()
  })

  it('is absent on a legacy asset, which reads as Erase only', () => {
    const legacy = photo('old', { kind: 'sticker', folder: 'Faces' })
    expect(recipeOf(legacy)).toBeNull()
    expect(stickerRecipeFrom(undefined)).toBeNull()
    // Untouched: a legacy record is not rewritten on hydration.
    expect(normalizePhotoRecipes([legacy])[0]).toBe(legacy)
  })

  it('keeps a stored original byte for byte when a re-save carries it forward', async () => {
    const stored = { type: 'image' as const, src: 'data:image/jpeg;base64,AAAA', name: 'cat.jpg', photoId: 'p1' }
    const recipe = await buildStickerRecipe(stored, STYLE)
    // No canvas, no second encode: the original is already the original.
    expect(recipe?.original).toBe(stored)
    expect(recipe?.style).toEqual(STYLE)
    // ... and a re-baked copy is re-editable again, with its own style.
    const restyled = await buildStickerRecipe(stored, { ...STYLE, outlineWidth: 38 })
    expect(restyled?.original).toEqual(stored)
    expect(restyled?.style.outlineWidth).toBe(38)
  })

  it('is dropped when the payload is not a complete recipe', () => {
    const legacy = photo('old', { kind: 'sticker' })
    const broken = [
      {},
      { original: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' } },
      { original: { type: 'text', text: 'hi' }, style: STYLE },
      { original: { type: 'image', name: 'cat.png' }, style: STYLE },
      { original: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' }, style: { ...STYLE, material: 'chrome' } },
      { original: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' }, style: { ...STYLE, baseName: undefined } },
      { original: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' }, style: { ...STYLE, perforation: { depth: 4 } } },
      // The shape this lane shipped before the original/result split: no original.
      { source: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' }, style: STYLE },
    ]
    for (const payload of broken) {
      expect(stickerRecipeFrom(payload)).toBeNull()
      // Hydration is the door every stored photo comes through: a half recipe
      // reads as the legacy state rather than feeding half a style to a bake.
      const out = normalizePhotoRecipes([{ ...legacy, recipe: payload as never }])[0]!
      expect(out.recipe).toBeUndefined()
      expect(recipeOf(out)).toBeNull()
    }
  })
})

describe('the recipe\'s paper texture', () => {
  it('round-trips the newspaper print through a session record', () => {
    const recipe = stickerRecipeFrom(payload({ ...STYLE, texture: 'newsprint' }))
    expect(recipe?.style.texture).toBe('newsprint')
    expect(stickerRecipeFrom(structuredClone(recipe))).toEqual(recipe)
  })

  it('reads an absent field and an explicit null as no texture', () => {
    const legacy: Partial<StickerBakeStyle> = { ...STYLE }
    delete legacy.texture
    expect(stickerRecipeFrom(payload(legacy))?.style.texture).toBeNull()
    expect(stickerRecipeFrom(payload({ ...STYLE, texture: null }))?.style.texture).toBeNull()
  })

  it('rejects anything that is not a frozen print', () => {
    const malformed = [
      { type: 'newsprint' },
      'wrinkle',
      'newsprints',
      '',
      ['newsprint'],
      60,
    ]
    for (const texture of malformed)
      expect(stickerRecipeFrom(payload({ ...STYLE, texture }))).toBeNull()
  })
})

describe('edited copies', () => {
  it('keep the source\'s folder on both depths and name themselves apart', () => {
    const filed = photo('cat', { kind: 'sticker', folder: 'Faces', name: 'cat.png' })
    expect(editedStickerMeta(filed, 'erased')).toEqual({ folder: 'Faces', baseName: 'cat (erased)' })
    expect(editedStickerMeta(filed, 'rebaked')).toEqual({ folder: 'Faces', baseName: 'cat (edited)' })

    const unsorted = photo('dog', { kind: 'sticker', name: 'dog.png' })
    expect(editedStickerMeta(unsorted, 'erased').folder).toBe('')
    expect(editedStickerMeta({ ...unsorted, name: '' }, 'erased').baseName).toBe('sticker (erased)')
  })

  it('erase lands a valid PNG record beside the sticker, with no recipe', async () => {
    const source = photo('cat', { kind: 'sticker', folder: 'Faces', name: 'cat.png' })
    useStore.setState({ photos: [source], stickerFolders: ['Faces'] })

    const made = await eraseStickerAsset(source, PNG_DATA_URL, key => key)
    expect(made).not.toBeNull()
    expect(made!.kind).toBe('sticker')
    expect(made!.name).toBe('cat (erased).png')
    expect(made!.folder).toBe('Faces')
    expect(made!.file.type).toBe('image/png')
    // A real PNG, byte for byte: the signature is what a decoder reads first.
    expect([...new Uint8Array(await made!.file.arrayBuffer()).slice(0, 8)]).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    // Hand work, not a recipe's output: Erase is its door, Re-edit is not.
    expect(recipeOf(made!)).toBeNull()

    // The snapshot principle: the source record is untouched in the library, so
    // every copy already placed keeps drawing the pixels it was placed with.
    const kept = useStore.getState().photos.find(p => p.id === 'cat')!
    expect(kept.file).toBe(source.file)
    expect([...new Uint8Array(await kept.file.arrayBuffer())]).toEqual([...pngBytes()])
    expect(kept.orphaned).toBeUndefined()
  })

  it('erase into Unsorted leaves the folder absent', async () => {
    const source = photo('dog', { kind: 'sticker', name: 'dog.png' })
    useStore.setState({ photos: [source], stickerFolders: [] })

    const made = await eraseStickerAsset(source, PNG_DATA_URL, key => key)
    expect(made!.folder).toBeUndefined()
    expect(useStore.getState().photos.find(p => p.id === made!.id)!.folder).toBeUndefined()
  })
})
