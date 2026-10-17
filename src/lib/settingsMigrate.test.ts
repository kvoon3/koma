/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DOCK_BG, DOCK_OPACITY, migrateSettings, SETTINGS_VERSION } from '../store'

describe('migrateSettings v9 (seam blend removed)', () => {
  test('version is 9', () => {
    expect(SETTINGS_VERSION).toBe(9)
  })
  test('saved blend settings are dropped, everything else survives', () => {
    const out = migrateSettings({ gap: 4, edgeFade: 120, edgeFadeStrength: 40, blendCrossfade: false }, 8)
    expect(out).not.toHaveProperty('edgeFade')
    expect(out).not.toHaveProperty('edgeFadeStrength')
    expect(out).not.toHaveProperty('blendCrossfade')
    expect(out.gap).toBe(4)
  })
})

describe('migrateSettings v2 (dock)', () => {
  test('v1 → v2 adds dock defaults and starts in row', () => {
    expect(migrateSettings({ gap: 2 }, 1)).toMatchObject({
      gap: 2,
      dockBg: DOCK_BG,
      dockOpacity: DOCK_OPACITY,
      toolsDockMode: 'row',
    })
  })
  test('v2 values are kept', () => {
    const v = { dockBg: 'liquid', dockOpacity: 30, toolsDockMode: 'row' }
    expect(migrateSettings({ ...v, dockHandleIcon: 'sliders' }, 2)).toMatchObject(v)
    expect(migrateSettings({ dockBg: 'frosted' }, 5).dockBg).toBe('frosted')
  })
  test('invalid values are sanitized', () => {
    expect(migrateSettings({ dockBg: 'neon', dockOpacity: 400, toolsDockMode: 'huge' }, 2)).toMatchObject({
      dockBg: DOCK_BG,
      dockOpacity: 100,
      toolsDockMode: 'row',
    })
  })
  test('null persisted state', () => {
    expect(migrateSettings(null, 0).toolsDockMode).toBe('row')
  })
})

describe('migrateSettings v4', () => {
  test('saved transparent dock style → default', () => {
    expect(migrateSettings({ dockBg: 'transparent', dockOpacity: 40 }, 3)).toMatchObject({ dockBg: DOCK_BG, dockOpacity: 40 })
  })
  test('v3 liquid is kept', () => {
    expect(migrateSettings({ dockBg: 'liquid' }, 3).dockBg).toBe('liquid')
  })
})

describe('migrateSettings v5', () => {
  test('default is solid', () => {
    expect(DOCK_BG).toBe('solid')
  })
  test('pre-v5 frosted (old default) → solid; liquid kept', () => {
    expect(migrateSettings({ dockBg: 'frosted' }, 4).dockBg).toBe('solid')
    expect(migrateSettings({ dockBg: 'liquid' }, 4).dockBg).toBe('liquid')
  })

  test('v5 → v6 resets the saved dock mode to row once', () => {
    expect(migrateSettings({ toolsDockMode: 'collapsed' }, 5).toolsDockMode).toBe('row')
    expect(migrateSettings({ toolsDockMode: 'expanded' }, 5).toolsDockMode).toBe('row')
    expect(migrateSettings({ toolsDockMode: 'collapsed' }, 6).toolsDockMode).toBe('collapsed')
  })
})

describe('migrateSettings v7', () => {
  test('adds the 1:1 grid cell ratio; keeps valid, fixes invalid', () => {
    expect(migrateSettings({}, 6).gridCellRatio).toBe('1:1')
    expect(migrateSettings({ gridCellRatio: '4:5' }, 6).gridCellRatio).toBe('4:5')
    expect(migrateSettings({ gridCellRatio: '2:1' }, 6).gridCellRatio).toBe('1:1')
  })
})

describe('migrateSettings v8 (collage background)', () => {
  test('pre-v8 gets no gradient and no photo', () => {
    expect(migrateSettings({ bg: '#ffffff' }, 7)).toMatchObject({ bg: '#ffffff', bgGradient: null, bgImage: null })
    expect(migrateSettings({}, 0)).toMatchObject({ bgGradient: null, bgImage: null })
  })
  test('v8 values are kept', () => {
    const bgImage = { photoId: 'p1', blur: true }
    expect(migrateSettings({ bgGradient: '#ff0000', bgImage }, 8)).toMatchObject({ bgGradient: '#ff0000', bgImage })
  })
})
