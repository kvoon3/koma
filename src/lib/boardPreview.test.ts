/// <reference types="bun" />
import type { Leaf, Node } from './panes'
import { describe, expect, test } from 'bun:test'
import { wallpaperPhotoIds } from './boardPreview'
import { newLeaf } from './panes'

const leaf = (photoId: string | null): Leaf => ({ ...newLeaf(), photoId })
const split = (a: Node, b: Node): Node => ({ type: 'split', id: `s-${a.id}-${b.id}`, dir: 'row', ratio: 0.5, a, b })
const cell = (id: string, root: Node) => ({ id, root, canvasRatio: null })

describe('wallpaperPhotoIds', () => {
  test('takes the first photo each cell carries', () => {
    const board = [
      cell('a', split(leaf(null), leaf('p1'))),
      cell('b', split(leaf('p2'), leaf('p3'))),
    ]
    expect(wallpaperPhotoIds(board)).toEqual(['p1', 'p2'])
  })

  test('a photo shared by two cells is drawn once', () => {
    const board = [
      cell('a', leaf('p1')),
      cell('b', split(leaf(null), leaf('p1'))),
      cell('c', leaf('p2')),
    ]
    expect(wallpaperPhotoIds(board)).toEqual(['p1', 'p2'])
  })

  test('empty cells contribute nothing', () => {
    expect(wallpaperPhotoIds([cell('a', leaf(null)), cell('b', leaf(null))])).toEqual([])
    expect(wallpaperPhotoIds([])).toEqual([])
  })

  test('a cell repeating its own photo adds one tile', () => {
    expect(wallpaperPhotoIds([cell('a', split(leaf('p1'), leaf('p1')))])).toEqual(['p1'])
  })
})
