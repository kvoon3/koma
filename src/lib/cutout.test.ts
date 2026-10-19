/// <reference types="bun" />
import { describe, expect, mock, test } from 'bun:test'
import { bindAction } from './actionGuard'
import { blurredCutoutFileName, cutoutAction, cutoutFileName, originalOf, recordCutout, restoreOriginalAction } from './cutout'

interface Ph { id: string }
const pane = (photo: Ph | null) => ({ pane: { paneId: 'pane1', photo } })

describe('cutout bookkeeping', () => {
  test('file name', () => {
    expect(cutoutFileName('IMG_1234.HEIC')).toBe('IMG_1234-cutout.png')
    expect(cutoutFileName('a.b.jpg')).toBe('a.b-cutout.png')
    expect(cutoutFileName('noext')).toBe('noext-cutout.png')
    expect(cutoutFileName('.png')).toBe('photo-cutout.png')
  })
  test('a cutout that kept its blurred backdrop stays recognisable', () => {
    expect(blurredCutoutFileName('IMG_1234.HEIC')).toBe('IMG_1234-cutout-blur.png')
    expect(blurredCutoutFileName('noext')).toBe('noext-cutout-blur.png')
    expect(blurredCutoutFileName('.png')).toBe('photo-cutout-blur.png')
  })
  test('record / original', () => {
    let m = recordCutout({}, 'c1', 'p1')
    expect(originalOf(m, 'c1')).toBe('p1')
    expect(originalOf(m, 'p1')).toBeNull()
    expect(originalOf(m, null)).toBeNull()
    // cutting a cutout keeps pointing at the first original
    m = recordCutout(m, 'c2', 'c1')
    expect(originalOf(m, 'c2')).toBe('p1')
  })
})

describe('cutout actions through actionGuard', () => {
  test('Cut out requires a photo', () => {
    const run = mock(() => {})
    const a = cutoutAction<Ph>({ cutouts: {}, busy: false }, run)
    expect(bindAction(a, { pane: null })).toBeNull()
    expect(bindAction(a, pane(null))).toBeNull()
    bindAction(a, pane({ id: 'p1' }))!()
    expect(run).toHaveBeenCalledWith('pane1', { id: 'p1' })
  })
  test('Cut out is off while busy or on a cutout', () => {
    expect(bindAction(cutoutAction<Ph>({ cutouts: {}, busy: true }, () => {}), pane({ id: 'p1' }))).toBeNull()
    expect(bindAction(cutoutAction<Ph>({ cutouts: { c1: 'p1' }, busy: false }, () => {}), pane({ id: 'c1' }))).toBeNull()
  })
  test('Original restores only a cutout whose original is still there', () => {
    const run = mock(() => {})
    const has = (id: string) => id === 'p1'
    const a = restoreOriginalAction<Ph>({ cutouts: { c1: 'p1', c9: 'gone' }, has }, run)
    expect(bindAction(a, pane({ id: 'p1' }))).toBeNull()
    expect(bindAction(a, pane({ id: 'c9' }))).toBeNull()
    bindAction(a, pane({ id: 'c1' }))!()
    expect(run).toHaveBeenCalledWith('pane1', 'p1')
  })
})
