/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { MAX_CANVAS_FILL, MIN_CANVAS_FILL } from '../store'
import { DEFAULT_LABEL_SIZE, MAX_LABEL_SIZE, MIN_LABEL_SIZE } from './panes'
import { assistValue, CANVAS_SCALE, CANVAS_WHEEL_SCALE, clamp01, clampValue, nextTickValue, RAIL_GIVE, RAIL_PAGE_STEPS, RAIL_TICK_GAP, railLadder, railTicks, railValueLabel, rubberBand, settleValue, stepValue, tallnessOfValue, tickY, valueAtTallness } from './scaleRail'
import { LABEL_SCALE, STICKER_SCALE } from './scaleTarget'

/** Half the bar's thickness: the bar's centre keeps this from either end. */
const INSET = 1.5

describe('the rail maps a value to tallness', () => {
  test('the ends are the bounds, on every target', () => {
    for (const scale of [CANVAS_SCALE, STICKER_SCALE, LABEL_SCALE]) {
      expect(valueAtTallness(0, scale)).toBeCloseTo(scale.min, 9)
      expect(valueAtTallness(1, scale)).toBeCloseTo(scale.max, 9)
      expect(tallnessOfValue(scale.min, scale)).toBeCloseTo(0, 9)
      expect(tallnessOfValue(scale.max, scale)).toBeCloseTo(1, 9)
    }
  })

  test('the canvas ends are the fill bounds', () => {
    expect(CANVAS_SCALE.min).toBe(MIN_CANVAS_FILL)
    expect(CANVAS_SCALE.max).toBe(MAX_CANVAS_FILL)
  })

  test('the mapping is linear in travel', () => {
    for (const scale of [CANVAS_SCALE, STICKER_SCALE, LABEL_SCALE]) {
      expect(tallnessOfValue((scale.min + scale.max) / 2, scale)).toBeCloseTo(0.5, 9)
      expect(valueAtTallness(0.5, scale)).toBeCloseTo((scale.min + scale.max) / 2, 9)
    }
  })

  test('round-trips a drag', () => {
    for (const scale of [CANVAS_SCALE, STICKER_SCALE, LABEL_SCALE]) {
      for (const t of [0, 0.25, 0.5, 0.75, 1])
        expect(tallnessOfValue(valueAtTallness(t, scale), scale)).toBeCloseTo(t, 9)
    }
  })

  test('the natural stop sits inside every range', () => {
    for (const scale of [CANVAS_SCALE, STICKER_SCALE, LABEL_SCALE]) {
      expect(scale.ref).toBeGreaterThan(scale.min)
      expect(scale.ref).toBeLessThan(scale.max)
      expect(tallnessOfValue(scale.ref, scale)).toBeGreaterThan(0)
      expect(tallnessOfValue(scale.ref, scale)).toBeLessThan(1)
    }
  })

  test('a value outside the bounds pins to the ends', () => {
    expect(valueAtTallness(-1, CANVAS_SCALE)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    expect(valueAtTallness(2, CANVAS_SCALE)).toBeCloseTo(MAX_CANVAS_FILL, 9)
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
    expect(clampValue(0, CANVAS_SCALE)).toBe(MIN_CANVAS_FILL)
    expect(clampValue(9, CANVAS_SCALE)).toBe(MAX_CANVAS_FILL)
    expect(clampValue(0, LABEL_SCALE)).toBe(MIN_LABEL_SIZE)
    expect(clampValue(999, LABEL_SCALE)).toBe(MAX_LABEL_SIZE)
  })

  test('an unusable value reads as the natural stop instead of NaN', () => {
    expect(tallnessOfValue(Number.NaN, CANVAS_SCALE)).toBeCloseTo(tallnessOfValue(1, CANVAS_SCALE), 9)
    expect(clampValue(Number.NaN, LABEL_SCALE)).toBe(DEFAULT_LABEL_SIZE)
  })
})

describe('the tick ladder', () => {
  // A tick's y on a track, for the gap assertions below.
  const gaps = (track: number, scale = CANVAS_SCALE) => {
    const ticks = railTicks(track, INSET, scale)
    const ys = ticks.map(t => tickY(t.tall, track, INSET))
    return { ticks, spacing: ys.slice(1).map((y, i) => Math.abs(y - ys[i])) }
  }

  test('a tall track marks every step, the bounds included', () => {
    const { ticks } = gaps(340)
    expect(ticks.map(t => +t.value.toFixed(2))).toEqual([
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

  test('every five steps is a longer mark, and the natural stop is its own', () => {
    const { ticks } = gaps(340)
    expect(ticks.filter(t => t.major).map(t => +t.value.toFixed(2))).toEqual([0.15, 0.5, 1, 1.5])
    expect(ticks.filter(t => t.ref).map(t => +t.value.toFixed(2))).toEqual([1])
    expect(ticks.find(t => t.ref)?.major).toBe(true)
  })

  test('the label line marks its default size, which is off the step grid', () => {
    const { ticks } = gaps(340, LABEL_SCALE)
    const refs = ticks.filter(t => t.ref)
    expect(refs).toHaveLength(1)
    expect(refs[0].value).toBeCloseTo(DEFAULT_LABEL_SIZE, 9)
    // The rest of the grid is tens: the ladder is the label's own units.
    for (const tick of ticks.filter(t => !t.ref && t.value !== LABEL_SCALE.min && t.value !== LABEL_SCALE.max))
      expect(Math.abs(tick.value % 10)).toBeLessThan(1e-9)
  })

  test('the sticker line marks a fresh sticker at its default', () => {
    const { ticks } = gaps(340, STICKER_SCALE)
    expect(ticks.filter(t => t.ref).map(t => +t.value.toFixed(2))).toEqual([0.2])
    expect(ticks[0].value).toBeCloseTo(STICKER_SCALE.min, 9)
  })

  test('a short track drops to a coarser ladder rather than a comb', () => {
    const tall = gaps(340).ticks
    const short = gaps(120).ticks
    expect(short.length).toBeLessThan(tall.length)
    // The landmarks stay whatever the track; the grid between them thins.
    expect(short.some(t => t.ref)).toBe(true)
    expect(short[0].value).toBeCloseTo(CANVAS_SCALE.min, 9)
    expect(short.at(-1)?.value).toBeCloseTo(CANVAS_SCALE.max, 9)
    for (const tick of short) {
      const isLandmark = tick.ref || tick.value === CANVAS_SCALE.min || tick.value === CANVAS_SCALE.max
      if (!isLandmark)
        expect(Math.abs((tick.value * 100) % 20)).toBeLessThan(1e-9)
    }
  })

  test('no two marks ever crowd closer than the gap', () => {
    for (const track of [340, 240, 150, 120, 96, 60]) {
      for (const scale of [CANVAS_SCALE, STICKER_SCALE, LABEL_SCALE]) {
        const { spacing } = gaps(track, scale)
        expect(spacing.length).toBeGreaterThan(0)
        for (const gap of spacing)
          expect(gap).toBeGreaterThanOrEqual(RAIL_TICK_GAP - 1e-9)
      }
    }
  })

  test('the ladder is ordered, inside the bounds, and keeps the natural stop', () => {
    for (const track of [340, 150, 60]) {
      for (const scale of [CANVAS_SCALE, STICKER_SCALE, LABEL_SCALE]) {
        const ticks = railTicks(track, INSET, scale)
        expect(ticks.some(t => t.ref)).toBe(true)
        for (const tick of ticks) {
          expect(tick.value).toBeGreaterThanOrEqual(scale.min - 1e-9)
          expect(tick.value).toBeLessThanOrEqual(scale.max + 1e-9)
          expect(tick.tall).toBeGreaterThanOrEqual(0)
          expect(tick.tall).toBeLessThanOrEqual(1)
        }
        for (let i = 1; i < ticks.length; i++)
          expect(ticks[i].value).toBeGreaterThan(ticks[i - 1].value)
      }
    }
  })

  test('the marks and the bar agree on where a value sits', () => {
    const track = 340
    const travel = track - 2 * INSET
    // Both ends: the bar's centre rides the same line as the end marks, the
    // smallest value at the bottom of the rail and the largest at its top.
    expect(tickY(1, track, INSET)).toBeCloseTo(INSET, 9)
    expect(tickY(0, track, INSET)).toBeCloseTo(INSET + travel, 9)
    expect(tickY(0.5, track, INSET)).toBeCloseTo(INSET + travel / 2, 9)
  })
})

describe('the keyboard walks the ladder', () => {
  test('one step is one mark, in both directions', () => {
    expect(nextTickValue(1, 1, CANVAS_SCALE)).toBeCloseTo(1.1, 9)
    expect(nextTickValue(1, -1, CANVAS_SCALE)).toBeCloseTo(0.9, 9)
    expect(nextTickValue(0.15, 1, CANVAS_SCALE)).toBeCloseTo(0.2, 9)
    expect(nextTickValue(0.2, -1, CANVAS_SCALE)).toBeCloseTo(0.15, 9)
  })

  test('a label steps in its own units, and can reach its default', () => {
    expect(nextTickValue(20, 1, LABEL_SCALE)).toBe(30)
    expect(nextTickValue(40, 1, LABEL_SCALE)).toBe(DEFAULT_LABEL_SIZE)
    expect(nextTickValue(DEFAULT_LABEL_SIZE, 1, LABEL_SCALE)).toBe(50)
    expect(nextTickValue(DEFAULT_LABEL_SIZE, -1, LABEL_SCALE)).toBe(40)
  })

  test('a value between marks steps onto the mark it is heading for', () => {
    // 103% has no mark of its own: up is 110%, down is 100%.
    expect(nextTickValue(1.03, 1, CANVAS_SCALE)).toBeCloseTo(1.1, 9)
    expect(nextTickValue(1.03, -1, CANVAS_SCALE)).toBeCloseTo(1, 9)
  })

  test('a page step is five marks, and the ends hold', () => {
    expect(RAIL_PAGE_STEPS).toBe(5)
    expect(nextTickValue(1, 1, CANVAS_SCALE, RAIL_PAGE_STEPS)).toBeCloseTo(1.5, 9)
    expect(nextTickValue(1, -1, CANVAS_SCALE, RAIL_PAGE_STEPS)).toBeCloseTo(0.5, 9)
    expect(nextTickValue(1, 1, CANVAS_SCALE, 99)).toBeCloseTo(MAX_CANVAS_FILL, 9)
    expect(nextTickValue(1, -1, CANVAS_SCALE, 99)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    expect(nextTickValue(MIN_CANVAS_FILL, -1, CANVAS_SCALE)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    expect(nextTickValue(MAX_CANVAS_FILL, 1, CANVAS_SCALE)).toBeCloseTo(MAX_CANVAS_FILL, 9)
  })

  test('every landing is on the ladder the rail draws from', () => {
    for (const scale of [CANVAS_SCALE, STICKER_SCALE, LABEL_SCALE]) {
      const ladder = railLadder(scale)
      let value = scale.min
      for (let i = 0; i < 40; i++) {
        value = nextTickValue(value, 1, scale)
        expect(ladder.some(v => Math.abs(v - value) < 1e-9)).toBe(true)
      }
      for (let i = 0; i < 40; i++) {
        value = nextTickValue(value, -1, scale)
        expect(ladder.some(v => Math.abs(v - value) < 1e-9)).toBe(true)
      }
    }
  })
})

describe('the natural stop is magnetic where a target asks for it', () => {
  test('the canvas leans onto the stage fit, and lands on it', () => {
    // 1 point out of the fit: half of that point is given up.
    expect(assistValue(1.01, CANVAS_SCALE)).toBeCloseTo(1.00475, 9)
    expect(assistValue(0.99, CANVAS_SCALE)).toBeCloseTo(0.99525, 9)
    // A release inside the capture radius takes the stop exactly; further out
    // the hand keeps what it stopped at.
    expect(settleValue(1.01, CANVAS_SCALE)).toBe(1)
    expect(settleValue(0.99, CANVAS_SCALE)).toBe(1)
    expect(settleValue(1.03, CANVAS_SCALE)).toBe(1.03)
    expect(settleValue(1.045, CANVAS_SCALE)).toBeCloseTo(1.045, 9)
  })

  test('the lean is monotonic: a continuing drag always escapes the stop', () => {
    let prev = Number.NEGATIVE_INFINITY
    let crossed = 0
    for (let fill = 0.85; fill <= 1.15; fill += 0.001) {
      const v = assistValue(fill, CANVAS_SCALE)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      if (prev < 1 && v >= 1)
        crossed++
      prev = v
    }
    expect(crossed).toBe(1)
  })

  test('a target with no magnet passes straight through', () => {
    for (const scale of [STICKER_SCALE, LABEL_SCALE]) {
      for (const v of [scale.min, scale.ref, (scale.min + scale.max) / 2, scale.max])
        expect(assistValue(v, scale)).toBe(v)
      expect(settleValue(scale.ref * 1.001, scale)).toBe(scale.ref * 1.001)
    }
  })
})

describe('the wheel steps a line', () => {
  test('a notch is a tenth of the value, either way', () => {
    expect(stepValue(1, 1, CANVAS_SCALE)).toBeCloseTo(1.1, 9)
    expect(stepValue(1, -1, CANVAS_SCALE)).toBeCloseTo(0.9091, 4)
    expect(stepValue(50, 2, LABEL_SCALE)).toBeCloseTo(60.5, 9)
    // Half a notch (a fine trackpad event) still moves.
    expect(stepValue(1, 0.5, CANVAS_SCALE)).toBeCloseTo(1.0488, 4)
  })

  test('a step is clamped to the bounds', () => {
    expect(stepValue(1.4, 5, CANVAS_SCALE)).toBeCloseTo(MAX_CANVAS_FILL, 9)
    expect(stepValue(0.2, -5, CANVAS_SCALE)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    expect(stepValue(0.2, -5, CANVAS_WHEEL_SCALE)).toBeCloseTo(MIN_CANVAS_FILL, 9)
    // The stage's wheel fits the canvas and never bleeds it past the fit.
    expect(stepValue(0.9, 3, CANVAS_WHEEL_SCALE)).toBeCloseTo(1, 9)
    expect(CANVAS_WHEEL_SCALE.max).toBe(CANVAS_SCALE.ref)
  })

  test('a step through the natural stop takes it exactly', () => {
    expect(stepValue(0.96, 0.5, CANVAS_SCALE)).toBe(1)
    expect(stepValue(1.04, -0.5, CANVAS_SCALE)).toBe(1)
    // And a step away from the stop is never caught by it: a fine wheel from
    // the fit always leaves (a wheel that cannot move would be a trap).
    expect(stepValue(1, 0.1, CANVAS_SCALE)).toBeGreaterThan(1)
    expect(stepValue(1, -0.1, CANVAS_SCALE)).toBeLessThan(1)
  })

  test('a line with no magnet just steps', () => {
    // The sticker and label lines have no detent (their default is a
    // double-click, not a wheel stop).
    expect(stepValue(0.2, 0.5, STICKER_SCALE)).toBeCloseTo(0.2098, 4)
    expect(stepValue(42, 0.5, LABEL_SCALE)).toBeCloseTo(44.05, 2)
  })

  test('a zero or unusable step leaves the value alone', () => {
    expect(stepValue(1.2, 0, CANVAS_SCALE)).toBe(1.2)
    expect(stepValue(1.2, Number.NaN, CANVAS_SCALE)).toBe(1.2)
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

describe('railValueLabel', () => {
  test('a scale reads as a percentage, a size as its own number', () => {
    expect(railValueLabel(1, 'percent')).toBe('100%')
    expect(railValueLabel(0.8, 'percent')).toBe('80%')
    expect(railValueLabel(1.5, 'percent')).toBe('150%')
    expect(railValueLabel(0.154, 'percent')).toBe('15%')
    expect(railValueLabel(DEFAULT_LABEL_SIZE, 'size')).toBe('42')
    expect(railValueLabel(12.4, 'size')).toBe('12')
    expect(railValueLabel(160, 'size')).toBe('160')
  })

  test('an unusable value is a dash, not NaN', () => {
    expect(railValueLabel(Number.NaN, 'percent')).toBe('-')
    expect(railValueLabel(0, 'size')).toBe('-')
  })
})
