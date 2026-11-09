/// <reference types="bun" />
import type { ExportItem } from '../components/ExportDialog'
import { describe, expect, test } from 'bun:test'
import { EXPORT_IDLE, exportBusy, exportItems, exportRunToRelease, exportTransition } from './exportSession'

const item: ExportItem = { kind: 'image', blob: new Blob(['x']), url: 'blob:x', name: 'x.png', w: 1, h: 1 }
const run = [item]

describe('exportTransition', () => {
  test('idle -> rendering -> previewing', () => {
    const rendering = exportTransition(EXPORT_IDLE, { type: 'start' })
    expect(rendering.phase).toBe('rendering')
    expect(exportBusy(rendering)).toBe(true)
    const previewing = exportTransition(rendering, { type: 'rendered', run })
    expect(previewing).toEqual({ phase: 'previewing', run })
    expect(exportItems(previewing)).toBe(run)
  })

  test('a second start is refused while rendering or previewing', () => {
    const rendering = exportTransition(EXPORT_IDLE, { type: 'start' })
    expect(exportTransition(rendering, { type: 'start' })).toBe(rendering)
    const previewing = exportTransition(rendering, { type: 'rendered', run })
    expect(exportTransition(previewing, { type: 'start' })).toBe(previewing)
  })

  test('a failure returns to idle with no run', () => {
    const rendering = exportTransition(EXPORT_IDLE, { type: 'start' })
    expect(exportTransition(rendering, { type: 'failed' })).toEqual(EXPORT_IDLE)
  })

  test('a stale rendered event is refused', () => {
    expect(exportTransition(EXPORT_IDLE, { type: 'rendered', run })).toBe(EXPORT_IDLE)
  })

  test('dismiss keeps the run alive through the close animation', () => {
    const previewing = exportTransition(exportTransition(EXPORT_IDLE, { type: 'start' }), { type: 'rendered', run })
    const releasing = exportTransition(previewing, { type: 'dismiss' })
    expect(releasing).toEqual({ phase: 'releasing', run })
    expect(exportItems(releasing)).toBeNull()
    expect(exportRunToRelease(releasing)).toBe(run)
    expect(exportTransition(releasing, { type: 'released' })).toEqual(EXPORT_IDLE)
  })

  test('released only applies to the releasing phase, so a stale callback cannot skip a preview', () => {
    const previewing = exportTransition(exportTransition(EXPORT_IDLE, { type: 'start' }), { type: 'rendered', run })
    expect(exportTransition(previewing, { type: 'released' })).toBe(previewing)
  })
})
