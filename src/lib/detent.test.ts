/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import {
  degToRad,
  detentTicks,
  dialDegAt,
  dialPercent,
  FINE_STEP_DEG,
  formatDeg,
  HARD_PULL_DEG,
  HARD_STEP_DEG,
  nearestStep,
  nudgeDeg,
  radToDeg,
  snapDetent,
  snapFine,
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
    expect(formatDeg(-0.2)).toBe('0°')
  })
})

describe('detent snapping', () => {
  it('nearestStep lands on a lattice point', () => {
    expect(nearestStep(37, SOFT_STEP_DEG)).toBe(30)
    expect(nearestStep(38, SOFT_STEP_DEG)).toBe(45)
    expect(nearestStep(-37, HARD_STEP_DEG)).toBe(0)
  })

  it('a detent drag always lands on a 15° tick', () => {
    expect(snapDetent(14)).toBe(15)
    expect(snapDetent(16)).toBe(15)
    expect(snapDetent(22)).toBe(15)
    expect(snapDetent(23)).toBe(30)
    expect(snapDetent(46)).toBe(45)
    expect(snapDetent(-46)).toBe(-45)
    expect(snapDetent(0.4)).toBe(0)
  })

  it('hard ticks own a wider band than the 15° lattice would give them', () => {
    // Half of the soft spacing is 7.5°: this band is wider, so 90° holds.
    expect(HARD_PULL_DEG).toBeGreaterThan(SOFT_STEP_DEG / 2)
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
    expect(snapFine(-0.4)).toBe(0)
    expect(snapFine(88.4)).toBe(88)
    expect(snapFine(359)).toBe(-1)
  })

  it('a keyboard nudge moves by the step it is given, wrapped', () => {
    expect(nudgeDeg(0, SOFT_STEP_DEG, 1)).toBe(15)
    expect(nudgeDeg(0, HARD_STEP_DEG, -1)).toBe(-90)
    expect(nudgeDeg(175, SOFT_STEP_DEG, 1)).toBe(-170)
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

  it('percentage across the track matches the angle', () => {
    expect(dialPercent(0)).toBe(50)
    expect(dialPercent(-90)).toBe(25)
    expect(dialPercent(90)).toBe(75)
    expect(dialPercent(180)).toBe(100)
  })

  it('a pointer position maps back to an angle', () => {
    expect(dialDegAt(0.5)).toBe(0)
    expect(dialDegAt(0.25)).toBe(-90)
    expect(dialDegAt(0.75)).toBe(90)
    // Clamped, so a pointer dragged past the track never asks for a turn and a half.
    expect(dialDegAt(-3)).toBe(180)
    expect(dialDegAt(9)).toBe(180)
  })

  it('a 15° tick is the Shift-snap the existing rotate handles use', () => {
    expect(degToRad(SOFT_STEP_DEG)).toBeCloseTo(ROTATION_SNAP, 12)
    expect(degToRad(HARD_STEP_DEG)).toBeCloseTo(Math.PI / 2, 12)
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12)
  })
})
