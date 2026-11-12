/// <reference types="bun" />
import type { Workspace } from '../store'
import type { MusicMeta } from './musicLink'
import type { SessionPhotoRecord } from './sessionStore'
import type { StickerRecipe } from './stickerRecipe'
import { describe, expect, it } from 'bun:test'
import { parseSessionMeta, parseSessionPhotoRecord, sessionMeta } from './sessionStore'
import { normalizeGrids } from './workspaces'

/** A cell of a board: only the id matters here, the boards are opaque. */
const cell = (id: string) => ({ id }) as Workspace
const board = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => cell(`${prefix}${i}`))

/** The store slices a session is written from, trimmed to what it reads. */
function source() {
  return {
    grids: [{ id: 'gA', name: 'Cover', hidden: true }, { id: 'gB', name: 'Variant' }],
    activeGridId: 'gB',
    workspaces: board('b', 2),
    activeId: 'b1',
    parkedBoards: { gA: { workspaces: board('a', 3), activeId: 'a2' } },
    stickerFolders: ['Faces'],
    photoTags: ['trip'],
    gap: 0,
    radius: 0,
    bg: '#000000',
    cutouts: {},
    cutoutSets: {},
    bgGradient: null,
    bgImage: null,
    longSide: 2048,
    format: 'image/jpeg' as const,
    quality: 0.92,
  }
}

/** What `hydrate` hands `normalizeGrids`: the meta as saved. */
function savedFrom(meta: ReturnType<typeof sessionMeta>) {
  return {
    grids: meta.grids,
    workspaces: meta.workspaces,
    activeGridId: meta.activeGridId,
    activeId: meta.activeId,
  }
}

describe('sessionMeta', () => {
  it('writes one entry per group, the open board from `workspaces`', () => {
    const meta = sessionMeta(source())
    expect(meta.grids?.map(g => [g.id, g.name, g.workspaces.length, g.activeId])).toEqual([
      ['gA', 'Cover', 3, 'a2'],
      ['gB', 'Variant', 2, 'b1'],
    ])
    expect(meta.activeGridId).toBe('gB')
    // The single-board field older builds read stays in step with the open group.
    expect(meta.workspaces).toHaveLength(2)
    expect(meta.activeId).toBe('b1')
    // Named folders and tags are library state and travel with the session.
    expect(meta.stickerFolders).toEqual(['Faces'])
    expect(meta.photoTags).toEqual(['trip'])
    // The cutout variant table travels too, so the Cut out menu works after a reload.
    expect(meta.cutoutSets).toEqual({})
  })

  it('round-trips through the hydration migration', () => {
    const out = normalizeGrids(savedFrom(sessionMeta(source())), () => cell('fresh'), () => 'gNew')
    expect(out.grids.map(g => g.name)).toEqual(['Cover', 'Variant'])
    // A tucked-away group stays tucked; the marker survives the round trip.
    expect(out.grids.map(g => g.hidden)).toEqual([true, undefined])
    expect(out.activeGridId).toBe('gB')
    expect(out.workspaces.map(w => w.id)).toEqual(['b0', 'b1'])
    expect(out.activeId).toBe('b1')
    expect(out.parked.gA).toEqual({ workspaces: board('a', 3), activeId: 'a2' })
    expect(out.parked.gB).toBeUndefined()
  })

  it('round-trips an untouched row too (hidden: false is what a save writes)', () => {
    const plain = { ...source(), grids: [{ id: 'gA', name: 'Cover' }, { id: 'gB', name: 'Variant' }] }
    const meta = sessionMeta(plain)
    expect(meta.grids?.map(g => g.hidden)).toEqual([false, false])
    const out = normalizeGrids(savedFrom(meta), () => cell('fresh'), () => 'gNew')
    expect(out.grids.map(g => g.hidden)).toEqual([undefined, undefined])
  })
})

// ---- The read boundary ------------------------------------------------------

const file = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })

/** A complete recipe, the shape `stickerRecipeFrom` accepts. */
function recipe(): StickerRecipe {
  return {
    original: { type: 'text', text: 'hi', color: '#ffffff', fontId: 'round' },
    style: {
      outlineWidth: 4,
      outlineColor: '#111111',
      material: 'holographic',
      baseName: 'sheet.png',
      perforation: null,
      displayLongEdge: 512,
      texture: null,
    },
  }
}

/** A complete music source, the canonical form `readMusicMeta` accepts. */
function music(): MusicMeta {
  return {
    provider: 'spotify',
    title: 'T',
    artist: 'A',
    url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
  }
}

function fullRecord(): SessionPhotoRecord {
  return {
    id: 'p1',
    name: 'IMG_1.png',
    trueW: 4,
    trueH: 4,
    file: file(),
    videoFile: file(),
    kind: 'sticker',
    folder: 'Faces',
    music: music(),
    tags: ['trip'],
    orphaned: true,
    recipe: recipe(),
    gps: { lat: 35.6, lng: 139.7 },
    takenAt: '2026-01-02T03:04:05Z',
  }
}

describe('parseSessionPhotoRecord', () => {
  it('reads a complete record back, every field kept', () => {
    const saved = fullRecord()
    const parsed = parseSessionPhotoRecord(saved)
    expect(parsed).toStrictEqual(saved)
  })

  it('reads a legacy record with no optional fields', () => {
    const parsed = parseSessionPhotoRecord({ id: 'p1', name: 'a.png', trueW: 4, trueH: 4, file: file() })
    expect(parsed?.id).toBe('p1')
    expect(parsed?.kind).toBeUndefined()
    expect(parsed?.tags).toBeUndefined()
    expect(parsed?.recipe).toBeUndefined()
  })

  it('rejects what is not one of our records', () => {
    expect(parseSessionPhotoRecord(null)).toBeNull()
    expect(parseSessionPhotoRecord('p1')).toBeNull()
    expect(parseSessionPhotoRecord({ ...fullRecord(), id: 7 })).toBeNull()
    expect(parseSessionPhotoRecord({ ...fullRecord(), name: null })).toBeNull()
    expect(parseSessionPhotoRecord({ ...fullRecord(), trueW: Number.NaN })).toBeNull()
    expect(parseSessionPhotoRecord({ ...fullRecord(), file: 'file.png' })).toBeNull()
  })

  it('reads a wrong-kind optional as absent, not as a failure', () => {
    const parsed = parseSessionPhotoRecord({
      ...fullRecord(),
      tags: 'trip',
      gps: { lat: 35.6 },
      videoFile: 'x.mov',
      orphaned: 'yes',
      takenAt: 1234,
    })
    expect(parsed?.tags).toBeUndefined()
    expect(parsed?.gps).toBeUndefined()
    expect(parsed?.videoFile).toBeUndefined()
    expect(parsed?.orphaned).toBeUndefined()
    expect(parsed?.takenAt).toBeUndefined()
    // The required half still opens the board.
    expect(parsed?.id).toBe('p1')
    expect(parsed?.file).toBeInstanceOf(File)
  })

  it('re-validates music and recipe instead of trusting them', () => {
    const badMusic = parseSessionPhotoRecord({ ...fullRecord(), music: { ...music(), url: 'https://evil.example/t' } })
    expect(badMusic?.music).toBeUndefined()
    const badRecipe = parseSessionPhotoRecord({ ...fullRecord(), recipe: { ...recipe(), style: { outlineWidth: 4 } } })
    expect(badRecipe?.recipe).toBeUndefined()
  })
})

describe('parseSessionMeta', () => {
  it('reads back what sessionMeta writes (the save → load round trip)', () => {
    const saved = sessionMeta(source())
    expect(parseSessionMeta(saved)).toStrictEqual(saved)
  })

  it('reads a legacy meta with no optional fields', () => {
    const saved = {
      workspaces: board('b', 2),
      activeId: 'b1',
      gap: 0,
      radius: 0,
      bg: '#000000',
      longSide: 2048,
      format: 'image/jpeg',
      quality: 0.92,
    }
    const parsed = parseSessionMeta(saved)
    expect(parsed?.activeId).toBe('b1')
    expect(parsed && 'grids' in parsed).toBe(false)
    expect(parsed && 'cutouts' in parsed).toBe(false)
    expect(parsed && 'bgGradient' in parsed).toBe(false)
  })

  it('rejects what is not one of our sessions', () => {
    expect(parseSessionMeta(null)).toBeNull()
    expect(parseSessionMeta('x')).toBeNull()
    expect(parseSessionMeta({ ...sessionMeta(source()), workspaces: 'nine cells' })).toBeNull()
    expect(parseSessionMeta({ ...sessionMeta(source()), workspaces: [{ id: 4 }] })).toBeNull()
    expect(parseSessionMeta({ ...sessionMeta(source()), format: 'image/webp' })).toBeNull()
    expect(parseSessionMeta({ ...sessionMeta(source()), gap: Number.NaN })).toBeNull()
    expect(parseSessionMeta({ ...sessionMeta(source()), activeId: 3 })).toBeNull()
  })

  it('keeps null distinct from absent for the background fields', () => {
    const saved = sessionMeta(source())
    expect(parseSessionMeta(saved)?.bgGradient).toBeNull()
    expect(parseSessionMeta(saved)?.bgImage).toBeNull()
    const absent = parseSessionMeta({ ...saved, bgGradient: undefined, bgImage: undefined })
    expect(absent && 'bgGradient' in absent).toBe(false)
    expect(absent && 'bgImage' in absent).toBe(false)
    const filled = parseSessionMeta({ ...saved, bgGradient: 'warm', bgImage: { photoId: 'p1', blur: true } })
    expect(filled?.bgGradient).toBe('warm')
    expect(filled?.bgImage).toStrictEqual({ photoId: 'p1', blur: true })
  })

  it('drops a wrong-shape optional whole, and one bad grid entry alone', () => {
    const saved = sessionMeta(source())
    const has = (meta: unknown, key: string) => typeof meta === 'object' && meta !== null && key in meta
    expect(has(parseSessionMeta({ ...saved, grids: 'one board' }), 'grids')).toBe(false)
    expect(has(parseSessionMeta({ ...saved, cutouts: { c1: 7 } }), 'cutouts')).toBe(false)
    expect(has(parseSessionMeta({ ...saved, stickerFolders: ['Faces', 2] }), 'stickerFolders')).toBe(false)
    const twoGrids = {
      ...saved,
      grids: [
        { id: 'gA', name: 'Cover', hidden: true, workspaces: board('a', 3), activeId: 'a2' },
        { id: 'gB', name: 'Variant', workspaces: board('b', 2), activeId: 'b1' },
      ],
    }
    const mixed = parseSessionMeta({ ...twoGrids, grids: [twoGrids.grids[0], { id: 'gC', name: 'Broken' }] })
    expect(mixed?.grids?.map(g => g.id)).toEqual(['gA'])
    const cutoutSets = parseSessionMeta({ ...saved, cutoutSets: { s1: { cutout: 'c.png' }, s2: { cutout: 'b.png', blurred: 'bl.png' } } })
    expect(cutoutSets?.cutoutSets).toStrictEqual({ s1: { cutout: 'c.png' }, s2: { cutout: 'b.png', blurred: 'bl.png' } })
  })
})
