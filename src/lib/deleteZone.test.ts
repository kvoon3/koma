/// <reference types="bun" />
import type { CollisionDetection } from '@dnd-kit/core'
import { describe, expect, test } from 'bun:test'
import { DELETE_ZONE_ID, deleteFirst } from './deleteZone'

type CollisionArgs = Parameters<CollisionDetection>[0]
type Droppable = CollisionArgs['droppableContainers'][number]
type Rect = CollisionArgs['droppableRects'] extends Map<unknown, infer R> ? R : never

/** A rect from its top-left corner and size, the shape every algorithm reads. */
function rect(x: number, y: number, w: number, h: number): Rect {
  return { top: y, left: x, right: x + w, bottom: y + h, width: w, height: h }
}

function container(id: string): Droppable {
  return { id, key: id, data: { current: undefined }, disabled: false, node: { current: null }, rect: { current: null } } as Droppable
}

/** The shared shape: a delete strip across the top, sortable tiles below it.
 * `drag` is the dragged node's own rect (the fallback ranks by its centre). */
function args(pointer: { x: number, y: number } | null, drag: Rect, ...tiles: { id: string, r: Rect }[]): CollisionArgs {
  return {
    active: { id: 'dragged' } as CollisionArgs['active'],
    collisionRect: drag,
    droppableRects: new Map([[DELETE_ZONE_ID, rect(0, 0, 375, 56)], ...tiles.map(t => [t.id, t.r] as const)]),
    droppableContainers: [container(DELETE_ZONE_ID), ...tiles.map(t => container(t.id))],
    pointerCoordinates: pointer,
  }
}

const detect: CollisionDetection = deleteFirst
const TILES = [
  { id: 'a', r: rect(18, 100, 100, 100) },
  { id: 'b', r: rect(200, 100, 100, 100) },
]
const DRAG = rect(100, 100, 100, 100)

describe('deleteFirst', () => {
  test('a pointer inside the strip deletes', () => {
    const hit = detect(args({ x: 187, y: 28 }, DRAG, ...TILES))
    expect(hit.map(c => c.id)).toEqual([DELETE_ZONE_ID])
  })

  test('a pointer inside a tile drops on the tile, and the strip never steals near-top drops', () => {
    const hit = detect(args({ x: 68, y: 150 }, DRAG, ...TILES))
    expect(hit.map(c => c.id)).toEqual(['a'])
  })

  test('a pointer resting in a gap falls back to the dragged rect\'s nearest centre, strip excluded', () => {
    const hit = detect(args({ x: 189, y: 150 }, rect(139, 100, 100, 100), ...TILES))
    expect(hit[0]?.id).toBe('b')
    expect(hit.map(c => c.id)).not.toContain(DELETE_ZONE_ID)
  })

  test('without a pointer (keyboard drag) the nearest centre decides, strip excluded', () => {
    const hit = detect(args(null, rect(0, 100, 100, 100), ...TILES))
    expect(hit[0]?.id).toBe('a')
    expect(hit.map(c => c.id)).not.toContain(DELETE_ZONE_ID)
  })
})
