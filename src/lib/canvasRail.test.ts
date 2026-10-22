/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { MAX_CANVAS_FILL, MIN_CANVAS_FILL } from '../store'
import {
  assistFill,
  clamp01,
  clampFill,
  fillAtTallness,
  fillLabel,
  FIT_CAPTURE_PTS,
  FIT_PULL_PTS,
  nextTickFill,
  RAIL_GIVE,
  RAIL_LADDER_PTS,
  RAIL_MAJOR_PTS,
  RAIL_PAGE_STEPS,
  RAIL_TICK_GAP,
  railTicks,
  rubberBand,
  settleFill,
  tallnessOfFill,
  tickY,
} from './canvasRail'

/** Half the bar's thickness: the bar's centre keeps this from either end. */
const INSET = 1.5

describe('the rail maps canvas scale to tallness', () => {
  test('the ends are the fill bounds', () => {
    expect(fillAtTallness(0)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    expect(fillAtTallness(1)).toBeCloseTo(MAX_CANVAS_FILL, 9)
    expect(tallnessOfFill(MIN_CANVAS_FILL)).toBeCloseTo(0, 9)
    expect(tallnessOfFill(MAX_CANVAS_FILL)).toBeCloseTo(1, 9)
  })

  test('the scale is linear in travel', () => {
    expect(tallnessOfFill((MIN_CANVAS_FILL + MAX_CANVAS_FILL) / 2)).toBeCloseTo(0.5, 9)
    expect(fillAtTallness(0.5)).toBeCloseTo((MIN_CANVAS_FILL + MAX_CANVAS_FILL) / 2, 9)
  })

  test('round-trips a drag', () => {
    for (const fill of [0.15, 0.4, 0.75, 1, 1.25, 1.5])
      expect(fillAtTallness(tallnessOfFill(fill))).toBeCloseTo(fill, 9)
  })

  test('up the rail is bigger, and fit sits between the ends', () => {
    expect(tallnessOfFill(1.25)).toBeGreaterThan(tallnessOfFill(1))
    expect(tallnessOfFill(0.5)).toBeLessThan(tallnessOfFill(1))
    expect(tallnessOfFill(1)).toBeGreaterThan(0)
    expect(tallnessOfFill(1)).toBeLessThan(1)
  })

  test('a position outside the rail pins to the ends', () => {
    expect(fillAtTallness(-1)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    expect(fillAtTallness(2)).toBeCloseTo(MAX_CANVAS_FILL, 9)
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
  })

  test('a scale outside the bounds pins to the ends', () => {
    expect(tallnessOfFill(10)).toBe(1)
    expect(tallnessOfFill(0.001)).toBe(0)
    expect(clampFill(0)).toBe(MIN_CANVAS_FILL)
    expect(clampFill(9)).toBe(MAX_CANVAS_FILL)
  })

  test('an unusable scale reads as the fit instead of NaN', () => {
    expect(tallnessOfFill(Number.NaN)).toBeCloseTo(tallnessOfFill(1), 9)
    expect(clampFill(Number.NaN)).toBe(1)
  })
})

describe('the tick ladder', () => {
  // A tick's y on a 340px track, for the gap assertions below.
  const gaps = (track: number) => {
    const ticks = railTicks(track, INSET)
    const ys = ticks.map(t => tickY(t.tall, track, INSET))
    return { ticks, spacing: ys.slice(1).map((y, i) => Math.abs(y - ys[i])) }
  }

  test('a tall track marks every tenth, the bounds included', () => {
    const { ticks } = gaps(340)
    expect(ticks.map(t => t.fill)).toEqual([
      0.15,
      0.2,
      0.3,
      0.4,
      0.5,
      0.6,
      0.7,
      0.8,
      0.9,
      1,
      1.1,
      1.2,
      1.3,
      1.4,
      1.5,
    ])
  })

  test('every half is a longer mark, and the fit is the tinted one', () => {
    const { ticks } = gaps(340)
    expect(ticks.filter(t => t.major).map(t => t.fill)).toEqual([0.15, 0.5, 1, 1.5])
    expect(ticks.filter(t => t.fit).map(t => t.fill)).toEqual([1])
    // The fit is a longer mark too: it is the stop the rail leans onto.
    expect(ticks.find(t => t.fit)?.major).toBe(true)
  })

  test('a short track drops to a coarser ladder rather than a comb', () => {
    const tall = gaps(340).ticks
    const short = gaps(120).ticks
    expect(short.length).toBeLessThan(tall.length)
    // Fifths: every mark is a tenth or a fifth, and the fit survives them all.
    for (const tick of short)
      expect(Math.abs((tick.fill * 100) % 20)).toBeLessThan(1e-9)
    expect(short.some(t => t.fit)).toBe(true)
  })

  test('no two marks ever crowd closer than the gap', () => {
    for (const track of [340, 240, 150, 120, 96, 60]) {
      const { spacing } = gaps(track)
      expect(spacing.length).toBeGreaterThan(0)
      for (const gap of spacing)
        expect(gap).toBeGreaterThanOrEqual(RAIL_TICK_GAP - 1e-9)
    }
  })

  test('the ladder is ordered, inside the bounds, and keeps the fit', () => {
    for (const track of [340, 150, 60]) {
      const ticks = railTicks(track, INSET)
      expect(ticks.some(t => t.fit && t.fill === 1)).toBe(true)
      for (const tick of ticks) {
        expect(tick.fill).toBeGreaterThanOrEqual(MIN_CANVAS_FILL)
        expect(tick.fill).toBeLessThanOrEqual(MAX_CANVAS_FILL)
        expect(tick.tall).toBeGreaterThanOrEqual(0)
        expect(tick.tall).toBeLessThanOrEqual(1)
      }
      for (let i = 1; i < ticks.length; i++)
        expect(ticks[i].fill).toBeGreaterThan(ticks[i - 1].fill)
    }
  })

  test('the marks and the bar agree on where a value sits', () => {
    const track = 340
    const travel = track - 2 * INSET
    // Both ends: the bar's centre rides the same line as the end marks, the
    // smallest scale at the bottom of the rail and the largest at its top.
    expect(tickY(1, track, INSET)).toBeCloseTo(INSET, 9)
    expect(tickY(0, track, INSET)).toBeCloseTo(INSET + travel, 9)
    // And a mark halfway up sits halfway between the bar's two extremes.
    expect(tickY(0.5, track, INSET)).toBeCloseTo(INSET + travel / 2, 9)
  })
})

describe('the keyboard walks the ladder', () => {
  test('one step is one mark, in both directions', () => {
    expect(nextTickFill(1, 1)).toBeCloseTo(1.1, 9)
    expect(nextTickFill(1, -1)).toBeCloseTo(0.9, 9)
    expect(nextTickFill(0.15, 1)).toBeCloseTo(0.2, 9)
    expect(nextTickFill(0.2, -1)).toBeCloseTo(0.15, 9)
  })

  test('a value between marks steps onto the mark it is heading for', () => {
    // 103% has no mark of its own: up is 110%, down is 100%.
    expect(nextTickFill(1.03, 1)).toBeCloseTo(1.1, 9)
    expect(nextTickFill(1.03, -1)).toBeCloseTo(1, 9)
  })

  test('a page step is half the range, and the ends hold', () => {
    expect(RAIL_PAGE_STEPS * RAIL_LADDER_PTS).toBe(RAIL_MAJOR_PTS)
    expect(nextTickFill(1, 1, RAIL_PAGE_STEPS)).toBeCloseTo(1.5, 9)
    expect(nextTickFill(1, -1, RAIL_PAGE_STEPS)).toBeCloseTo(0.5, 9)
    expect(nextTickFill(1, 1, 99)).toBeCloseTo(MAX_CANVAS_FILL, 9)
    expect(nextTickFill(1, -1, 99)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    expect(nextTickFill(MIN_CANVAS_FILL, -1)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    expect(nextTickFill(MAX_CANVAS_FILL, 1)).toBeCloseTo(MAX_CANVAS_FILL, 9)
  })

  test('every landing is a mark the ladder can draw', () => {
    const marks = new Set(railTicks(340, INSET).map(t => t.fill))
    let fill = 0.4
    for (let i = 0; i < 40; i++) {
      fill = nextTickFill(fill, 1)
      expect(marks.has(fill)).toBe(true)
    }
    for (let i = 0; i < 40; i++) {
      fill = nextTickFill(fill, -1)
      expect(marks.has(fill)).toBe(true)
    }
  })
})

describe('the fit is magnetic', () => {
  test('a drag away from the fit is untouched, to the point', () => {
    for (const fill of [0.5, 0.9, 0.93, 1.07, 1.2, 1.5])
      expect(assistFill(fill)).toBe(fill)
  })

  test('inside the band the scale leans toward 100%', () => {
    expect(FIT_PULL_PTS).toBeGreaterThan(FIT_CAPTURE_PTS)
    // 1 point out of the fit: half of that point is given up, and the grip can
    // still leave (the lean never removes more than the band's own edge).
    expect(assistFill(1.01)).toBeCloseTo(1.00475, 9)
    expect(assistFill(0.99)).toBeCloseTo(0.99525, 9)
    expect(Math.abs(assistFill(1.01) - 1)).toBeLessThan(0.01)
    // At the stop itself the lean is at full strength but still continuous.
    expect(assistFill(1)).toBe(1)
    // The band's edge is where the lean stops: outside it nothing moves.
    expect(assistFill(1 + FIT_PULL_PTS / 100)).toBeCloseTo(1 + FIT_PULL_PTS / 100, 9)
    expect(assistFill(1 - FIT_PULL_PTS / 100)).toBeCloseTo(1 - FIT_PULL_PTS / 100, 9)
  })

  test('the lean is monotonic: a continuing drag always escapes the fit', () => {
    let prev = Number.NEGATIVE_INFINITY
    let crossed = 0
    for (let fill = 0.85; fill <= 1.15; fill += 0.001) {
      const v = assistFill(fill)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      if (prev < 1 && v >= 1)
        crossed++
      prev = v
    }
    expect(crossed).toBe(1)
    // And it never pushes past the band's own edges.
    expect(assistFill(0.98)).toBeLessThan(1)
    expect(assistFill(1.03)).toBeGreaterThan(1)
  })

  test('a release next to the fit lands on it exactly', () => {
    expect(settleFill(1.01)).toBe(1)
    expect(settleFill(0.99)).toBe(1)
    expect(settleFill(1 + FIT_CAPTURE_PTS / 100)).toBe(1)
    // Past the capture radius the hand keeps its scale, decimals and all.
    expect(settleFill(1.03)).toBe(1.03)
    expect(settleFill(0.96)).toBe(0.96)
    expect(settleFill(0.4)).toBe(0.4)
  })

  test('settling never leaves the bounds', () => {
    expect(settleFill(0)).toBe(MIN_CANVAS_FILL)
    expect(settleFill(9)).toBe(MAX_CANVAS_FILL)
  })
})

describe('the ends give instead of stopping dead', () => {
  test('a small overshoot tracks the pointer', () => {
    expect(rubberBand(0)).toBe(0)
    // It covers most of the first px (tanh, so a hair under 1:1).
    expect(rubberBand(2)).toBeGreaterThan(1.9)
    expect(rubberBand(2)).toBeLessThan(2)
    // Symmetric: up past the top and down past the bottom move the same way.
    expect(rubberBand(-3)).toBeCloseTo(-rubberBand(3), 12)
  })

  test('the give is bounded however far the pointer goes', () => {
    expect(Math.abs(rubberBand(30))).toBeLessThan(RAIL_GIVE)
    expect(Math.abs(rubberBand(4000))).toBeLessThanOrEqual(RAIL_GIVE)
    expect(rubberBand(4000)).toBeGreaterThan(RAIL_GIVE * 0.99)
    // Monotonic, so a drag into the end never bounces back on its own.
    let prev = -1
    for (let px = 0; px <= 60; px += 0.5) {
      const v = rubberBand(px)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  test('an unusable overshoot is no overshoot', () => {
    expect(rubberBand(Number.NaN)).toBe(0)
    expect(rubberBand(5, 0)).toBe(0)
  })
})

describe('fillLabel', () => {
  test('names the scale against the fit', () => {
    expect(fillLabel(1)).toBe('100%')
    expect(fillLabel(0.8)).toBe('80%')
    expect(fillLabel(1.5)).toBe('150%')
    expect(fillLabel(0.154)).toBe('15%')
  })

  test('an unusable scale is a dash, not NaN', () => {
    expect(fillLabel(Number.NaN)).toBe('-')
  })
})
