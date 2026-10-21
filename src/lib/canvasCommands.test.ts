/// <reference types="bun" />
import { beforeEach, describe, expect, test } from 'bun:test'
import { emptyHistory, historyPath } from './history'

// The store's `document` / `localStorage` stand-ins are the shared ones every
// test file boots on (src/testSetup.ts, via bunfig `[test] preload`).

const { activeWs, useStore } = await import('../store')
const { clampCanvasRatio, flipCanvasRatio, flippedRatio, matchCanvasToFirstPhoto, setCanvasRatio, SQUARE_RATIO } = await import('./canvasCommands')

const boot = useStore.getState()
const ws = () => activeWs(useStore.getState())

beforeEach(() => {
  useStore.setState({ ...boot, history: emptyHistory() })
})

describe('ratio helpers', () => {
  test('flippedRatio turns a landscape canvas on its side', () => {
    expect(flippedRatio(2)).toBe(0.5)
    expect(flippedRatio(flippedRatio(3 / 2))).toBeCloseTo(3 / 2)
  })
  test('clampCanvasRatio keeps what setCanvasSize accepts', () => {
    expect(clampCanvasRatio(SQUARE_RATIO)).toBe(1)
    expect(clampCanvasRatio(0.01)).toBe(0.12)
    expect(clampCanvasRatio(100)).toBe(8)
  })
})

describe('canvas ratio commands', () => {
  test('square sets the ratio and keeps the fill', () => {
    useStore.getState().setCanvasSize(3 / 2, 0.8)
    setCanvasRatio(SQUARE_RATIO)
    expect(ws().canvasRatio).toBe(1)
    expect(ws().canvasFill).toBeCloseTo(0.8)
  })

  test('each command commits through setCanvasSize (undoable)', () => {
    // One command, one entry: `commit` needs no extra push of its own.
    useStore.setState({ history: emptyHistory() })
    setCanvasRatio(SQUARE_RATIO)
    expect(historyPath(useStore.getState().history)).toHaveLength(2)
    expect(ws().canvasRatio).toBe(1)
    useStore.getState().undo()
    expect(ws().canvasRatio).toBeNull()
  })

  test('flip swaps the ratio and reports whether it had one', () => {
    expect(flipCanvasRatio()).toBe(false)
    expect(ws().canvasRatio).toBeNull()
    useStore.getState().setCanvasSize(3 / 2, 1)
    expect(flipCanvasRatio()).toBe(true)
    expect(ws().canvasRatio).toBeCloseTo(2 / 3)
  })

  test('follow the first photo needs a sized photo', () => {
    expect(matchCanvasToFirstPhoto()).toBe(false)
    useStore.setState({
      photos: [{
        id: 'photo-1',
        name: 'a.png',
        url: '',
        type: 'image/png',
        size: 1,
        trueW: 1200,
        trueH: 800,
      } as never],
    })
    expect(matchCanvasToFirstPhoto()).toBe(true)
    expect(ws().canvasRatio).toBeCloseTo(3 / 2)
  })

  test('a nonsense ratio is ignored instead of clearing the canvas', () => {
    useStore.getState().setCanvasSize(3 / 2, 1)
    setCanvasRatio(Number.NaN)
    setCanvasRatio(0)
    setCanvasRatio(-2)
    expect(ws().canvasRatio).toBeCloseTo(3 / 2)
  })
})
