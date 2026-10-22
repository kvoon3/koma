import type { Workspace } from '../store'
/// <reference types="bun" />
import type { Photo } from './imageStore'
import type { Leaf, Node } from './panes'
import { describe, expect, test } from 'bun:test'
import {
  addFolder,
  boardRefs,
  deleteFolder,
  dropCutoutRefs,
  folderOf,
  foldersInUse,
  gcRetired,
  MAX_FOLDER_NAME,
  musicAssetsOf,
  normalizePhotoKinds,
  paneAssetsOf,
  photoAssetsOf,
  pruneCutouts,
  referenceCounts,
  renameFolder,
  retirePhoto,
  stickerAssetsOf,
  usesOf,
  withFolder,
} from './stickerLibrary'

function photo(id: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    name: `${id}.png`,
    file: new File([], `${id}.png`, { type: 'image/png' }),
    trueW: 100,
    trueH: 100,
    ...extra,
  }
}

const sticker = (id: string, folder?: string) => photo(id, { kind: 'sticker', folder })

function leaf(photoId: string | null, stickers: { photoId: string }[] = []): Leaf {
  return {
    type: 'leaf',
    id: `p${photoId ?? 'x'}${stickers.length}`,
    photoId,
    zoom: 1,
    cx: 0.5,
    cy: 0.5,
    stickers: stickers.map((s, i) => ({ id: `s${i}`, photoId: s.photoId, x: 0.5, y: 0.5, s: 0.2 })),
    label: null,
  }
}

const split = (a: Node, b: Node): Node => ({ type: 'split', id: 'sp', dir: 'row', ratio: 0.5, a, b })

function board(root: Node, stickers: { photoId: string }[] = []): Workspace {
  return {
    id: 'w1',
    root,
    focusId: 'f',
    canvasRatio: null,
    canvasFill: 1,
    stickers: stickers.map((s, i) => ({ id: `b${i}`, photoId: s.photoId, x: 0.5, y: 0.5, s: 0.2 })),
    labels: [],
  }
}

describe('hydration of legacy sessions', () => {
  test('every photo saved without a kind lands as a photo', () => {
    const out = normalizePhotoKinds([photo('a'), photo('b')])
    expect(out.map(p => p.kind)).toEqual(['photo', 'photo'])
  })

  test('a sticker keeps its kind and its folder', () => {
    const out = normalizePhotoKinds([sticker('s', 'Faces')])
    expect(out[0].kind).toBe('sticker')
    expect(out[0].folder).toBe('Faces')
  })

  test('the retired marker survives hydration, and nothing else is touched', () => {
    const out = normalizePhotoKinds([photo('gone', { orphaned: true })])
    expect(out[0]).toEqual({ ...photo('gone', { orphaned: true }), kind: 'photo' })
  })
})

describe('the two library lists', () => {
  const photos = [photo('p1'), sticker('s1'), photo('p2', { kind: 'photo' }), sticker('gone', undefined)]

  test('stickers are out of the photo library, photos out of the sticker page', () => {
    expect(photoAssetsOf(photos).map(p => p.id)).toEqual(['p1', 'p2'])
    expect(stickerAssetsOf(photos).map(p => p.id)).toEqual(['s1', 'gone'])
  })

  test('a retired asset is out of both', () => {
    const list = [...photos.map(p => (p.id === 's1' ? { ...p, orphaned: true } : p))]
    expect(stickerAssetsOf(list).map(p => p.id)).toEqual(['gone'])
    expect(photoAssetsOf(list).some(p => p.id === 's1')).toBe(false)
  })

  test('a kind neither library knows is in neither list', () => {
    const music = { ...photo('m1'), kind: 'music' as string } as Photo
    expect(photoAssetsOf([photo('p1'), music]).map(p => p.id)).toEqual(['p1'])
    expect(stickerAssetsOf([sticker('s1'), music]).map(p => p.id)).toEqual(['s1'])
  })

  test('music cards have their own list, and join photos for a pane', () => {
    const list = [photo('p1'), sticker('s1'), photo('m1', { kind: 'music' }), photo('m2', { kind: 'music', orphaned: true })]
    expect(musicAssetsOf(list).map(p => p.id)).toEqual(['m1'])
    expect(paneAssetsOf(list).map(p => p.id)).toEqual(['p1', 'm1'])
  })
})

describe('folders', () => {
  test('a sticker reads its folder, "" being Unsorted', () => {
    expect(folderOf(sticker('a', '  Faces '))).toBe('Faces')
    expect(folderOf(sticker('b'))).toBe('')
    expect(folderOf(photo('c'))).toBe('')
  })

  test('moving to a folder normalizes, and "" clears it', () => {
    expect(withFolder(sticker('a'), ' Faces ').folder).toBe('Faces')
    expect(withFolder(sticker('a', 'Faces'), '').folder).toBeUndefined()
  })

  test('folders in use are distinct and sorted, Unsorted excluded', () => {
    expect(foldersInUse([sticker('a', 'Faces'), sticker('b', 'Animals'), sticker('c'), sticker('d', 'Faces')]))
      .toEqual(['Animals', 'Faces'])
  })

  test('creating: blank is refused, spaces collapse, duplicates are case-insensitive', () => {
    expect(addFolder([], '   ')).toEqual({ ok: false, reason: 'empty' })
    const trimmed = addFolder([], '  Big   Faces  ')
    expect(trimmed).toEqual({ ok: true, folders: ['Big Faces'], name: 'Big Faces' })
    expect(addFolder(['Faces'], 'faces')).toEqual({ ok: false, reason: 'duplicate' })
    expect(addFolder(['Faces'], ' FACES ')).toEqual({ ok: false, reason: 'duplicate' })
  })

  test('creating: the name is capped without leaving a trailing space', () => {
    const long = addFolder([], `${'x'.repeat(MAX_FOLDER_NAME)}   tail`)
    expect(long.ok).toBe(true)
    expect(long.ok && long.name).toBe('x'.repeat(MAX_FOLDER_NAME))
    const spaced = addFolder([], `${'y'.repeat(MAX_FOLDER_NAME)} tail`)
    expect(spaced.ok && spaced.name).toBe('y'.repeat(MAX_FOLDER_NAME))
    expect(spaced.ok && spaced.name.endsWith(' ')).toBe(false)
  })

  test('renaming: a missing folder, self-rename and a taken name', () => {
    expect(renameFolder(['Faces'], 'Nope', 'x')).toEqual({ ok: false, reason: 'missing' })
    expect(renameFolder(['Faces'], 'Faces', '  ')).toEqual({ ok: false, reason: 'empty' })
    expect(renameFolder(['Faces', 'Animals'], 'Faces', 'animals')).toEqual({ ok: false, reason: 'duplicate' })
  })

  test('renaming to its own name in another case is a rename, not a duplicate', () => {
    const out = renameFolder(['Faces', 'Animals'], 'Faces', 'faces')
    expect(out).toEqual({ ok: true, folders: ['faces', 'Animals'], name: 'faces' })
  })

  test('deleting a folder drops only that one; an unknown name changes nothing', () => {
    expect(deleteFolder(['Faces', 'Animals'], 'Faces')).toEqual(['Animals'])
    expect(deleteFolder(['Faces'], 'Nope')).toEqual(['Faces'])
  })
})

describe('usage', () => {
  test('pane photos, pane stickers and board stickers all count', () => {
    const w = board(split(leaf('p1', [{ photoId: 's1' }]), leaf('p2')), [{ photoId: 's1' }, { photoId: 's2' }])
    const counts = boardRefs(w)
    expect(counts.get('p1')).toBe(1)
    expect(counts.get('p2')).toBe(1)
    expect(counts.get('s1')).toBe(2)
    expect(counts.get('s2')).toBe(1)
    expect(usesOf(counts, 's9')).toBe(0)
  })

  test('an empty pane references nothing', () => {
    expect(boardRefs(board(leaf(null))).size).toBe(0)
  })

  test('the count spans every board passed in, plus the single ids', () => {
    const open = board(leaf('p1'), [{ photoId: 's1' }])
    const parked = { ...board(leaf(null, [{ photoId: 's1' }])), id: 'w2' }
    const counts = referenceCounts([open, parked], ['p1', null, undefined])
    expect(counts.get('s1')).toBe(2)
    expect(counts.get('p1')).toBe(2)
    expect([...counts.keys()].sort()).toEqual(['p1', 's1'])
  })
})

describe('delete keeps placed copies', () => {
  test('an asset nothing draws leaves the library', () => {
    const photos = [sticker('s1'), photo('p1')]
    const out = retirePhoto(photos, 's1', new Set(['p1']))
    expect(out.map(p => p.id)).toEqual(['p1'])
  })

  test('a drawn asset is retired instead: hidden, still there, still renderable', () => {
    const photos = [sticker('s1'), photo('p1')]
    const out = retirePhoto(photos, 's1', new Set(['s1']))
    expect(out.map(p => p.id)).toEqual(['s1', 'p1'])
    expect(out[0].orphaned).toBe(true)
    // Still resolvable by the photos map the preview and the exporter read.
    expect(out.some(p => p.id === 's1')).toBe(true)
    expect(stickerAssetsOf(out)).toEqual([])
  })

  test('an unknown id changes nothing', () => {
    const photos = [sticker('s1')]
    expect(retirePhoto(photos, 'nope', new Set())).toBe(photos)
  })

  test('collection drops the retired assets nothing draws, and only those', () => {
    const photos = [
      sticker('live', undefined),
      { ...sticker('kept', undefined), orphaned: true },
      { ...sticker('dropped', undefined), orphaned: true },
      photo('p1'),
    ]
    const out = gcRetired(photos, new Set(['live', 'kept', 'p1']))
    expect(out.map(p => p.id)).toEqual(['live', 'kept', 'p1'])
  })

  test('a deleted asset takes its cutout links with it', () => {
    const map = { s1: 'p1', s2: 's1', s3: 'p3' }
    expect(dropCutoutRefs(map, 's1')).toEqual({ s3: 'p3' })
    // s2's original is gone with it; s3 keeps a link to a photo that is still here.
    expect(pruneCutouts(map, new Set(['s2', 'p3', 's3']))).toEqual({ s3: 'p3' })
  })
})
