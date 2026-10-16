/// <reference types="bun" />
import type { Action } from './actionGuard'
import { describe, expect, mock, test } from 'bun:test'
import { bindAction, paneContext } from './actionGuard'

interface Ph { w: number }
const none = { pane: null }
const empty = { pane: { paneId: 'a', photo: null } }
const full = { pane: { paneId: 'a', photo: { w: 10 } } }

describe('bindAction', () => {
  test('requires none: always bound', () => {
    const run = mock(() => {})
    bindAction<Ph>({ requires: 'none', run }, none)!()
    expect(run).toHaveBeenCalledTimes(1)
  })
  test('requires pane: null without a selection, gets the target with one', () => {
    const run = mock((_t: { paneId: string }) => {})
    const a: Action<Ph> = { requires: 'pane', run }
    expect(bindAction(a, none)).toBeNull()
    bindAction(a, empty)!()
    expect(run).toHaveBeenCalledWith({ paneId: 'a', photo: null })
  })
  test('requires photo: null for no selection or an empty pane', () => {
    const run = mock((_t: { photo: Ph }) => {})
    const a: Action<Ph> = { requires: 'photo', run }
    expect(bindAction(a, none)).toBeNull()
    expect(bindAction(a, empty)).toBeNull()
    bindAction(a, full)!()
    expect(run.mock.calls[0]![0].photo.w).toBe(10)
  })
  test('when: extra predicate gates the action', () => {
    const a: Action<Ph> = { requires: 'pane', run: () => {}, when: () => false }
    expect(bindAction(a, empty)).toBeNull()
    const b: Action<Ph> = { requires: 'photo', run: () => {}, when: t => t.photo.w > 20 }
    expect(bindAction(b, full)).toBeNull()
  })
})

describe('paneContext', () => {
  const lookup = (id: string) => (id === 'a' ? { photo: null } : null)
  test('no focus → no pane', () => {
    expect(paneContext(null, lookup).pane).toBeNull()
    expect(paneContext('', lookup).pane).toBeNull()
  })
  test('stale focus id → no pane', () => {
    expect(paneContext('gone', lookup).pane).toBeNull()
  })
  test('live focus → target', () => {
    expect(paneContext('a', lookup).pane).toEqual({ paneId: 'a', photo: null })
  })
})
