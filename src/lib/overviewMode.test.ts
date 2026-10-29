import type { OverviewEvent, OverviewMode } from './overviewMode'
import { describe, expect, it } from 'bun:test'
import { nextOverviewMode, OVERVIEW_POLICY } from './overviewMode'

const MODES: OverviewMode[] = ['browse', 'jiggle', 'manage']
const EVENTS: OverviewEvent[] = ['hold-air', 'open-manager', 'close-manager', 'done']

describe('nextOverviewMode', () => {
  it('matches the transition table', () => {
    expect(nextOverviewMode('browse', 'hold-air')).toBe('jiggle')
    expect(nextOverviewMode('browse', 'open-manager')).toBe('manage')
    expect(nextOverviewMode('jiggle', 'open-manager')).toBe('manage')
    expect(nextOverviewMode('jiggle', 'done')).toBe('browse')
    expect(nextOverviewMode('manage', 'close-manager')).toBe('browse')
  })

  it('is total and idempotent on an event that does not apply', () => {
    for (const mode of MODES) {
      for (const event of EVENTS) {
        const next = nextOverviewMode(mode, event)
        expect(nextOverviewMode(next, event)).toBe(next)
      }
    }
    // The specific illegal mixtures: manage never nests, and manage cannot be
    // entered or left by the wrong door.
    expect(nextOverviewMode('manage', 'hold-air')).toBe('manage')
    expect(nextOverviewMode('manage', 'open-manager')).toBe('manage')
    expect(nextOverviewMode('browse', 'close-manager')).toBe('browse')
    expect(nextOverviewMode('browse', 'done')).toBe('browse')
    expect(nextOverviewMode('jiggle', 'hold-air')).toBe('jiggle')
  })
})

describe('OVERVIEW_POLICY', () => {
  it('keeps browse the only mode that enters a cell and jiggle the only one that deletes', () => {
    expect(OVERVIEW_POLICY.browse.entersCell).toBe(true)
    expect(OVERVIEW_POLICY.jiggle.entersCell).toBe(false)
    expect(OVERVIEW_POLICY.manage.entersCell).toBe(false)
    expect(OVERVIEW_POLICY.browse.deletesCells).toBe(false)
    expect(OVERVIEW_POLICY.jiggle.deletesCells).toBe(true)
    expect(OVERVIEW_POLICY.manage.deletesCells).toBe(false)
  })

  it('pages everywhere but the manager, and Done only in jiggle', () => {
    expect(OVERVIEW_POLICY.browse.pages).toBe(true)
    expect(OVERVIEW_POLICY.jiggle.pages).toBe(true)
    expect(OVERVIEW_POLICY.manage.pages).toBe(false)
    expect(OVERVIEW_POLICY.browse.showsDone).toBe(false)
    expect(OVERVIEW_POLICY.jiggle.showsDone).toBe(true)
    expect(OVERVIEW_POLICY.manage.showsDone).toBe(false)
  })

  it('holds air into jiggle only from browse, and an air tap exits only in jiggle', () => {
    expect(OVERVIEW_POLICY.browse.airHoldEntersJiggle).toBe(true)
    expect(OVERVIEW_POLICY.jiggle.airHoldEntersJiggle).toBe(false)
    expect(OVERVIEW_POLICY.manage.airHoldEntersJiggle).toBe(false)
    expect(OVERVIEW_POLICY.browse.airTapExits).toBe(false)
    expect(OVERVIEW_POLICY.jiggle.airTapExits).toBe(true)
    expect(OVERVIEW_POLICY.manage.airTapExits).toBe(false)
  })
})
