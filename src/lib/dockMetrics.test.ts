/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { compactDockBand, DOCK_HANDLE_H, DOCK_METRICS_FALLBACK, dockBand } from './dockMetrics'

describe('the dock bands', () => {
  test('the fallback compact band is 107', () => {
    expect(DOCK_HANDLE_H).toBe(28)
    expect(compactDockBand(DOCK_METRICS_FALLBACK)).toBe(107)
    expect(compactDockBand(DOCK_METRICS_FALLBACK)).toBe(dockBand(DOCK_METRICS_FALLBACK, 'icons'))
  })

  test('the labelled row is 131 on the fallbacks', () => {
    expect(dockBand(DOCK_METRICS_FALLBACK, 'row')).toBe(131)
    // The expanded fallback is the row height until the sheet measures.
    expect(dockBand(DOCK_METRICS_FALLBACK, 'expanded')).toBe(131)
  })

  test('a measured sheet publishes its own heights', () => {
    const metrics = { iconH: 40, rowH: 60, expH: 220, footerH: 30 }
    expect(compactDockBand(metrics)).toBe(98)
    expect(dockBand(metrics, 'icons')).toBe(98)
    expect(dockBand(metrics, 'row')).toBe(118)
    expect(dockBand(metrics, 'expanded')).toBe(278)
  })

  test('the bands keep the display order: compact, row, expanded', () => {
    const metrics = { iconH: 44, rowH: 68, expH: 152, footerH: 31 }
    expect(compactDockBand(metrics)).toBe(103)
    expect(dockBand(metrics, 'row')).toBe(127)
    expect(dockBand(metrics, 'expanded')).toBe(211)
    expect(compactDockBand(metrics)).toBeLessThan(dockBand(metrics, 'row'))
    expect(dockBand(metrics, 'row')).toBeLessThan(dockBand(metrics, 'expanded'))
  })
})
