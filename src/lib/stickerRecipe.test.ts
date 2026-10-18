/// <reference types="bun" />
import type { Photo } from './imageStore'
import type { StickerBakeStyle } from './stickerAssets'
import { describe, expect, it } from 'bun:test'
import { useStore } from '../store'
import { eraseStickerAsset } from './stickerAssets'
import { buildStickerRecipe, editedStickerMeta, normalizePhotoRecipes, recipeOf, stickerRecipeFrom } from './stickerRecipe'

/**
 * The re-edit metadata: what a made sticker carries so the library can reopen
 * the maker over it, and what a legacy asset (made before re-editing) carries
 * instead: nothing, which is why it offers Erase only.
 *
 * The bake itself is canvas work and is measured in the browser (`makeSticker`
 * cannot run under bun); here the recipe's own lifecycle is pinned: built from
 * the maker's controls, attached to the asset, round-tripped through a session
 * record, and read back, or dropped for a payload that is not a complete
 * recipe.
 */

const STYLE: StickerBakeStyle = {
  outlineWidth: 18,
  outlineColor: '#ffffff',
  material: 'holographic',
  baseName: 'cat',
  perforation: { depth: 4, spacing: 12 },
  displayLongEdge: 220,
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
  const stored = JSON.parse(JSON.stringify({ ...record, file: undefined })) as Photo
  return { ...stored, file: record.file }
}

describe('a made sticker\'s recipe', () => {
  it('is built from the maker\'s controls and survives a session record', async () => {
    const recipe = await buildStickerRecipe(
      { type: 'text', text: 'hi', color: '#000000', fontId: 'rounded' },
      STYLE,
    )
    expect(recipe).toEqual({ source: { type: 'text', text: 'hi', color: '#000000', fontId: 'rounded' }, style: STYLE })

    // The asset carries it, exactly as `addStickerAsset` leaves it.
    const made = photo('a', { kind: 'sticker', folder: 'Faces', recipe: recipe! })
    expect(recipeOf(made)).toEqual(recipe)
    expect(recipeOf(throughSession(made))).toEqual(recipe)
  })

  it('lands on the sticker record through the store, and on nothing else', async () => {
    const sticker = photo('s', { kind: 'sticker' })
    const plain = photo('p')
    useStore.setState({ photos: [sticker, plain] })

    const recipe = (await buildStickerRecipe({ type: 'text', text: 'hi', color: '#000000', fontId: 'system' }, STYLE))!
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

  it('is dropped when the payload is not a complete recipe', () => {
    const legacy = photo('old', { kind: 'sticker' })
    const broken = [
      {},
      { source: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' } },
      { source: { type: 'text', text: 'hi' }, style: STYLE },
      { source: { type: 'image', name: 'cat.png' }, style: STYLE },
      { source: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' }, style: { ...STYLE, material: 'chrome' } },
      { source: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' }, style: { ...STYLE, baseName: undefined } },
      { source: { type: 'text', text: 'hi', color: '#000000', fontId: 'system' }, style: { ...STYLE, perforation: { depth: 4 } } },
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
