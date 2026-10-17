/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import {
  assistDeg,
  degToRad,
  detentTicks,
  dialDegAt,
  dialPercent,
  FINE_STEP_DEG,
  formatDeg,
  FULL_TURN_DEG,
  HARD_CAPTURE_DEG,
  HARD_PULL_DEG,
  HARD_STEP_DEG,
  nearestStep,
  nudgeDeg,
  radToDeg,
  settleDeg,
  snapDetent,
  snapFine,
  SOFT_ASSIST_DEG,
  SOFT_STEP_DEG,
  wrapDeg,
} from './detent'
import { ROTATION_SNAP } from './panes'

describe('wrapDeg', () => {
  it('folds a turn onto (-180, 180]', () => {
    expect(wrapDeg(0)).toBe(0)
    expect(wrapDeg(45)).toBe(45)
    expect(wrapDeg(180)).toBe(180)
    // -180 is the same orientation as +180, and the seam belongs to the latter.
    expect(wrapDeg(-180)).toBe(180)
    expect(wrapDeg(190)).toBe(-170)
    expect(wrapDeg(-190)).toBe(170)
    expect(wrapDeg(540)).toBe(180)
    expect(wrapDeg(-540)).toBe(180)
  })

  it('never returns -0, so a readout cannot render "-0°"', () => {
    expect(Object.is(wrapDeg(-0), 0)).toBe(true)
    expect(Object.is(wrapDeg(-360), 0)).toBe(true)
    // A real half-degree to the left is a real reading; only the round-off to
    // zero is folded, so the seam never renders "-0°".
    expect(formatDeg(-0.2)).toBe('-0.2°')
    expect(formatDeg(-0.04)).toBe('0°')
    expect(Object.is(assistDeg(-0), 0)).toBe(true)
    expect(Object.is(settleDeg(-0), 0)).toBe(true)
  })
})

describe('stepless drag: the detents are a feel, not a lattice', () => {
  it('an angle away from every tick is stored exactly as the pointer maps it', () => {
    // No hard band (±10 of 90), no soft band (±4 of 15): nothing moves the hand.
    expect(assistDeg(23.7)).toBe(23.7)
    expect(assistDeg(23)).toBe(23)
    expect(assistDeg(37)).toBe(37)
    expect(assistDeg(-49.5)).toBe(-49.5)
    expect(assistDeg(53.7)).toBe(53.7)
    expect(assistDeg(-68.5)).toBe(-68.5)
  })

  it('a soft tick leans the angle toward it, lighter than a hard tick', () => {
    // 1° off a 15° tick: the soft lean keeps ~0.55° of it.
    expect(assistDeg(14)).toBeCloseTo(14.45, 12)
    expect(assistDeg(16)).toBeCloseTo(15.55, 12)
    // The lean fades to nothing at the band's edge, so the map is continuous.
    expect(assistDeg(SOFT_STEP_DEG - SOFT_ASSIST_DEG)).toBe(11)
    expect(assistDeg(SOFT_STEP_DEG + SOFT_ASSIST_DEG)).toBe(19)
    // Symmetric, and a soft tick never hands back a negative zero.
    expect(assistDeg(-14)).toBeCloseTo(-14.45, 12)
    expect(assistDeg(SOFT_STEP_DEG)).toBe(SOFT_STEP_DEG)
  })

  it('a hard tick leans harder, across the wider HARD_PULL_DEG band', () => {
    // Half of the soft spacing is 7.5°: this band is wider, so 90° holds.
    expect(HARD_PULL_DEG).toBeGreaterThan(SOFT_STEP_DEG / 2)
    // 1° off 90°: only 0.28° survives the lean.
    expect(assistDeg(89)).toBeCloseTo(89.72, 12)
    expect(assistDeg(91)).toBeCloseTo(90.28, 12)
    expect(assistDeg(82)).toBeCloseTo(83.28, 12)
    expect(assistDeg(97)).toBeCloseTo(95.32, 12)
    expect(assistDeg(-82)).toBeCloseTo(-83.28, 12)
    // The band's edge is where the lean stops: outside it the angle is untouched.
    expect(assistDeg(80)).toBe(80)
    expect(assistDeg(100)).toBe(100)
    expect(assistDeg(0)).toBe(0)
  })

  it('a hard tick holds more than a soft one at the same distance', () => {
    // 1° out: the soft lean moves the value 0.45°, the hard one 0.72°.
    expect(Math.abs(assistDeg(14) - 14)).toBeCloseTo(0.45, 12)
    expect(Math.abs(assistDeg(89) - 89)).toBeCloseTo(0.72, 12)
  })

  it('the lean is monotonic: a continuing drag always escapes a tick', () => {
    // Walking the pointer one tenth of a degree at a time never stalls or turns
    // back, and 70° → 110° really does pass through 90° and out the far side.
    let prev = Number.NEGATIVE_INFINITY
    let crossed = 0
    for (let raw = -179.9; raw <= 180; raw += 0.1) {
      const v = assistDeg(raw)
      expect(v).toBeGreaterThanOrEqual(prev)
      if (prev < 90 && v >= 90)
        crossed++
      prev = v
    }
    expect(crossed).toBe(1)
    expect(assistDeg(110)).toBe(110)
    // 6° past the tick the band is done: release keeps that, it does not settle.
    expect(settleDeg(assistDeg(96))).toBeCloseTo(94.08, 12)
  })

  it('the lean stays inside the band, so the angle is never captured while dragging', () => {
    // A contraction can never remove more than half its band: 90° is reachable
    // only by the pointer, and the knob is never dragged off to a lattice.
    for (let raw = 80; raw <= 100; raw += 0.5)
      expect(Math.abs(assistDeg(raw) - raw)).toBeLessThanOrEqual(HARD_PULL_DEG / 2)
  })

  it('the seam at ±180 reads as one orientation, wrapped', () => {
    expect(assistDeg(179)).toBeCloseTo(179.72, 12)
    expect(assistDeg(-179)).toBeCloseTo(-179.72, 12)
    // Just right of the seam the hand reads a negative angle, still leaning on 180.
    expect(assistDeg(-179.6)).toBeCloseTo(-179.9072, 12)
    expect(assistDeg(-179.6) + FULL_TURN_DEG).toBeLessThan(FULL_TURN_DEG)
  })
})

describe('release settle', () => {
  it('a hard tick within HARD_CAPTURE_DEG takes the angle exactly', () => {
    expect(HARD_CAPTURE_DEG).toBeLessThanOrEqual(3)
    expect(settleDeg(89.3)).toBe(90)
    expect(settleDeg(91.9)).toBe(90)
    expect(settleDeg(-88.5)).toBe(-90)
    expect(settleDeg(0.4)).toBe(0)
    expect(settleDeg(180)).toBe(180)
    // Both ends of the dial fold onto the +180 seam, as the wrap does.
    expect(settleDeg(178.4)).toBe(180)
    expect(settleDeg(-178.6)).toBe(180)
  })

  it('outside the capture radius the exact angle is kept, decimals and all', () => {
    expect(settleDeg(23.7)).toBe(23.7)
    expect(settleDeg(86.4)).toBe(86.4)
    expect(settleDeg(-94)).toBe(-94)
    // Soft ticks never capture: they are felt while dragging only.
    expect(settleDeg(14)).toBe(14)
    expect(settleDeg(16.5)).toBe(16.5)
  })
})

describe('quantized landings (the keyboard, the 1° path)', () => {
  it('nearestStep lands on a lattice point', () => {
    expect(nearestStep(37, SOFT_STEP_DEG)).toBe(30)
    expect(nearestStep(38, SOFT_STEP_DEG)).toBe(45)
    expect(nearestStep(-37, HARD_STEP_DEG)).toBe(0)
  })

  it('a quantized detent drag always lands on a 15° tick', () => {
    expect(snapDetent(14)).toBe(15)
    expect(snapDetent(16)).toBe(15)
    expect(snapDetent(22)).toBe(15)
    expect(snapDetent(23)).toBe(30)
    expect(snapDetent(46)).toBe(45)
    expect(snapDetent(-46)).toBe(-45)
    expect(snapDetent(0.4)).toBe(0)
  })

  it('hard ticks own a wider band than the 15° lattice would give them', () => {
    expect(snapDetent(82)).toBe(90)
    expect(snapDetent(97)).toBe(90)
    expect(snapDetent(79)).toBe(75)
    expect(snapDetent(101)).toBe(105)
    expect(snapDetent(-83)).toBe(-90)
  })

  it('both ends of the dial fold onto the +180 seam', () => {
    expect(snapDetent(179)).toBe(180)
    expect(snapDetent(-179)).toBe(180)
    expect(snapDetent(-100)).toBe(-90)
  })

  it('the fine path keeps 1° steps and ignores the detents', () => {
    expect(FINE_STEP_DEG).toBe(1)
    expect(snapFine(14.4)).toBe(14)
    expect(snapFine(14.6)).toBe(15)
    expect(snapFine(23.7)).toBe(24)
    expect(snapFine(-0.4)).toBe(0)
    expect(snapFine(88.4)).toBe(88)
    expect(snapFine(359)).toBe(-1)
  })

  it('a keyboard nudge moves by the step it is given, wrapped', () => {
    expect(nudgeDeg(0, SOFT_STEP_DEG, 1)).toBe(15)
    expect(nudgeDeg(0, HARD_STEP_DEG, -1)).toBe(-90)
    expect(nudgeDeg(23.7, FINE_STEP_DEG, 1)).toBeCloseTo(24.7, 12)
    expect(nudgeDeg(175, SOFT_STEP_DEG, 1)).toBe(-170)
  })
})

describe('the readout', () => {
  it('shows one decimal at most, and drops a whole degree\'s ".0"', () => {
    expect(formatDeg(23.7)).toBe('23.7°')
    expect(formatDeg(-23.74)).toBe('-23.7°')
    expect(formatDeg(90)).toBe('90°')
    expect(formatDeg(22)).toBe('22°')
    expect(formatDeg(89.96)).toBe('90°')
    expect(formatDeg(23.700000000000003)).toBe('23.7°')
    expect(formatDeg(0)).toBe('0°')
    expect(formatDeg(-0.04)).toBe('0°')
  })
})

describe('dial geometry', () => {
  it('ticks run a full turn, hard on the 90° ones', () => {
    const ticks = detentTicks()
    expect(ticks).toHaveLength(360 / SOFT_STEP_DEG + 1)
    expect(ticks[0]).toEqual({ deg: -180, hard: true })
    expect(ticks.at(-1)).toEqual({ deg: 180, hard: true })
    expect(ticks.filter(t => t.hard).map(t => t.deg)).toEqual([-180, -90, 0, 90, 180])
  })

  it('percentage across the track matches the angle, decimals included', () => {
    expect(dialPercent(0)).toBe(50)
    expect(dialPercent(-90)).toBe(25)
    expect(dialPercent(90)).toBe(75)
    expect(dialPercent(180)).toBe(100)
    expect(dialPercent(23.7)).toBeCloseTo((23.7 + 180) / 3.6, 12)
  })

  it('a pointer position maps back to an angle, undetented', () => {
    expect(dialDegAt(0.5)).toBe(0)
    expect(dialDegAt(0.25)).toBe(-90)
    expect(dialDegAt(0.75)).toBe(90)
    // Clamped, so a pointer dragged past the track never asks for a turn and a half.
    expect(dialDegAt(-3)).toBe(180)
    expect(dialDegAt(9)).toBe(180)
    // The mapping is linear in between: 23.7° sits at its own ratio.
    expect(dialDegAt((23.7 + 180) / 360)).toBeCloseTo(23.7, 12)
  })

  it('a 15° tick is the Shift-snap the existing rotate handles use', () => {
    expect(degToRad(SOFT_STEP_DEG)).toBeCloseTo(ROTATION_SNAP, 12)
    expect(degToRad(HARD_STEP_DEG)).toBeCloseTo(Math.PI / 2, 12)
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12)
  })
})
