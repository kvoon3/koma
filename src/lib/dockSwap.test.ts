/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DOCK_SWAP_PX, DOCK_SWAP_S, planDockSwap } from './dockSwap'

describe('planDockSwap', () => {
  test('a list replaced by another list slides both ways, one after the other', () => {
    expect(planDockSwap({ hadContent: true, midSwap: false, reduce: false })).toEqual({
      ghost: { delayS: 0, durationS: DOCK_SWAP_S / 2 },
      enter: { delayS: DOCK_SWAP_S / 2, durationS: DOCK_SWAP_S / 2 },
    })
  })
  test('the first population just appears: nothing to slide out', () => {
    expect(planDockSwap({ hadContent: false, midSwap: false, reduce: false })).toEqual({ ghost: null, enter: null })
  })
  test('the arrival half of a two-batch swap (route change) still slides in', () => {
    // The old route's portal unloaded first (exit ran), the new one mounts now.
    expect(planDockSwap({ hadContent: false, midSwap: true, reduce: false })).toEqual({
      ghost: null,
      enter: { delayS: 0, durationS: DOCK_SWAP_S },
    })
  })
  test('reduced motion swaps instantly, both halves', () => {
    expect(planDockSwap({ hadContent: true, midSwap: true, reduce: true })).toEqual({ ghost: null, enter: null })
  })

  test('paired halves hand off: the entrance starts exactly where the exit ends', () => {
    const { ghost, enter } = planDockSwap({ hadContent: true, midSwap: false, reduce: false })
    expect(ghost).not.toBeNull()
    expect(enter).not.toBeNull()
    expect(ghost!.delayS + ghost!.durationS).toBe(enter!.delayS)
    expect(enter!.delayS + enter!.durationS).toBe(DOCK_SWAP_S)
  })
  test('an entrance alone keeps the full window, with no dead delay', () => {
    const { enter } = planDockSwap({ hadContent: false, midSwap: true, reduce: false })
    expect(enter).toEqual({ delayS: 0, durationS: DOCK_SWAP_S })
  })
})

describe('DOCK_SWAP_PX', () => {
  test('stays a nudge: paired with the 180ms duration, no page-style travel', () => {
    expect(DOCK_SWAP_PX).toBeGreaterThan(0)
    expect(DOCK_SWAP_PX).toBeLessThanOrEqual(40)
  })
})
