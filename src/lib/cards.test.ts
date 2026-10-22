/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { cardWorkspace } from './cards'
import { leafList } from './panes'

const identity = (key: string) => key

describe('card presets', () => {
  test('a cover card is square with a title and an artist', () => {
    const ws = cardWorkspace('cover', identity)
    expect(ws.canvasRatio).toBe(1)
    expect(leafList(ws.root)).toHaveLength(1)
    expect(leafList(ws.root)[0]!.photoId).toBeNull()
    expect(ws.labels.map(l => l.text)).toEqual(['Your title', 'Your artist'])
    expect(ws.labels.map(l => l.align)).toEqual(['left', 'left'])
  })

  test('a lyrics card is 4:5 with centered copy and a credit', () => {
    const ws = cardWorkspace('lyrics', identity)
    expect(ws.canvasRatio).toBe(0.8)
    expect(leafList(ws.root)).toHaveLength(1)
    expect(ws.labels.map(l => l.text)).toEqual(['Your lyrics', 'Your artist'])
    expect(ws.labels.map(l => l.align)).toEqual(['center', 'center'])
  })

  test('every call gets fresh workspace and label ids', () => {
    const a = cardWorkspace('cover', identity)
    const b = cardWorkspace('cover', identity)
    expect(a.id).not.toBe(b.id)
    expect(a.root.id).not.toBe(b.root.id)
    expect(a.labels[0]!.id).not.toBe(b.labels[0]!.id)
  })
})
