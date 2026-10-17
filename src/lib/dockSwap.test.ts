/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DOCK_SWAP_PX, planDockSwap } from './dockSwap'

describe('planDockSwap', () => {
  test('a list replaced by another list slides both ways', () => {
    expect(planDockSwap({ hadContent: true, midSwap: false, reduce: false })).toEqual({ ghost: true, enter: true })
  })
  test('the first population just appears: nothing to slide out', () => {
    expect(planDockSwap({ hadContent: false, midSwap: false, reduce: false })).toEqual({ ghost: false, enter: false })
  })
  test('the arrival half of a two-batch swap (route change) still slides in', () => {
    // The old route's portal unloaded first (exit ran), the new one mounts now.
    expect(planDockSwap({ hadContent: false, midSwap: true, reduce: false })).toEqual({ ghost: false, enter: true })
  })
  test('reduced motion swaps instantly, both halves', () => {
    expect(planDockSwap({ hadContent: true, midSwap: true, reduce: true })).toEqual({ ghost: false, enter: false })
  })
})

describe('DOCK_SWAP_PX', () => {
  test('stays a nudge: paired with the 180ms duration, no page-style travel', () => {
    expect(DOCK_SWAP_PX).toBeGreaterThan(0)
    expect(DOCK_SWAP_PX).toBeLessThanOrEqual(40)
  })
})
