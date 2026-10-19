/// <reference types="bun" />
import type { Workspace } from '../store'
import { describe, expect, it } from 'bun:test'
import { sessionMeta } from './sessionStore'
import { normalizeGrids } from './workspaces'

/** A cell of a board: only the id matters here, the boards are opaque. */
const cell = (id: string) => ({ id }) as Workspace
const board = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => cell(`${prefix}${i}`))

/** The store slices a session is written from, trimmed to what it reads. */
function source() {
  return {
    grids: [{ id: 'gA', name: 'Cover' }, { id: 'gB', name: 'Variant' }],
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
    expect(out.activeGridId).toBe('gB')
    expect(out.workspaces.map(w => w.id)).toEqual(['b0', 'b1'])
    expect(out.activeId).toBe('b1')
    expect(out.parked.gA).toEqual({ workspaces: board('a', 3), activeId: 'a2' })
    expect(out.parked.gB).toBeUndefined()
  })
})
