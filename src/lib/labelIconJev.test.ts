/// <reference types="bun" />
import type { JevConfig } from './jev'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { emptyHistory } from './history'

// The preload stand-ins in src/testSetup.ts are in place before this import.
const { activeWs, useStore } = await import('../store')
const { JEV_NONE_CHOICE } = await import('./jev')
const { pickLabelIconFor, requestLabelIcon } = await import('./labelIconJev')

const CONFIG: JevConfig = { url: new URL('https://api.typesafe.ai/v1/systemone'), key: null }
const realFetch = globalThis.fetch
const boot = useStore.getState()

beforeEach(() => {
  useStore.setState({ ...boot, history: emptyHistory() })
  globalThis.fetch = realFetch
})

afterAll(() => {
  globalThis.fetch = realFetch
})

function labelOf(id: string) {
  return activeWs(useStore.getState()).labels.find(label => label.id === id)
}

/** Commit a text the way `commitEdit` does, and hand back the label id. */
function commit(text: string): string {
  const id = useStore.getState().addLabel(0.5, 0.5)
  useStore.getState().setLabel(id, { text })
  return id
}

const wire: { body?: Record<string, unknown>, init?: RequestInit } = {}

function resetWire() {
  wire.body = undefined
  wire.init = undefined
}

/** Swap the global fetch for one request, typed the way Bun types its own. */
function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(input, init)) as typeof fetch
}

function answerWith(choice: string, confidence = 0.9): void {
  mockFetch((_input, init) => {
    wire.body = JSON.parse(String(init?.body ?? '{}'))
    wire.init = init ?? {}
    return Response.json({
      model: 'jev-1.14.0',
      answers: { label_icon: { type: 'choice', choice, confidence } },
    })
  })
}

/** A fetch held open, so a test can change the label before it answers. */
function pendingAnswer() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  mockFetch(async () => {
    await gate
    return Response.json({
      model: 'jev-1.14.0',
      answers: { label_icon: { type: 'choice', choice: 'cake', confidence: 0.9 } },
    })
  })
  return () => release()
}

describe('a committed label text gets Jev\'s icon', () => {
  test('the pick lands on the label and its text is unchanged', async () => {
    resetWire()
    answerWith('cake')
    const id = commit('生日蛋糕')

    await pickLabelIconFor(id, '生日蛋糕', CONFIG)

    expect(labelOf(id)).toMatchObject({ text: '生日蛋糕', icon: 'cake' })
    expect(wire.body?.state).toBe('生日蛋糕')
    const questions = (wire.body?.questions ?? {}) as Record<string, { type: string, criteria: Record<string, string> }>
    const question = questions.label_icon
    expect(question).toBeDefined()
    expect(question.type).toBe('choice')
    expect(question.criteria.cake).toBe('Cake')
    expect(question.criteria[JEV_NONE_CHOICE]).toBeDefined()
    // Every catalog icon is a candidate, plus "none"; none is dropped.
    expect(Object.keys(question.criteria)).toHaveLength(129)
    const headers = wire.init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['TypeSafe-Danger-Zone-Images']).toBeUndefined()
  })

  test('none leaves the label text-only', async () => {
    answerWith(JEV_NONE_CHOICE)
    const id = commit('随便写写')
    await pickLabelIconFor(id, '随便写写', CONFIG)
    expect(labelOf(id)).toMatchObject({ text: '随便写写' })
    expect(labelOf(id)?.icon).toBeUndefined()
  })

  test('a failed call leaves the label text-only and does not throw', async () => {
    mockFetch(() => Promise.reject(new Error('offline')))
    const id = commit('生日蛋糕')
    await pickLabelIconFor(id, '生日蛋糕', CONFIG)
    expect(labelOf(id)).toMatchObject({ text: '生日蛋糕' })
    expect(labelOf(id)?.icon).toBeUndefined()
  })

  test('the fire-and-forget trigger never surfaces a rejection', () => {
    mockFetch(() => Promise.reject(new Error('offline')))
    const id = commit('生日蛋糕')
    expect(() => requestLabelIcon(id, '生日蛋糕')).not.toThrow()
  })
})

describe('a stale answer does not apply', () => {
  test('the text was edited again before the answer arrived', async () => {
    const release = pendingAnswer()
    const id = commit('旧标题')
    const pending = pickLabelIconFor(id, '旧标题', CONFIG)

    useStore.getState().setLabel(id, { text: '新标题' })
    release()
    await pending

    expect(labelOf(id)).toMatchObject({ text: '新标题' })
    expect(labelOf(id)?.icon).toBeUndefined()
  })

  test('the label was removed before the answer arrived', async () => {
    const release = pendingAnswer()
    const id = commit('生日蛋糕')
    const pending = pickLabelIconFor(id, '生日蛋糕', CONFIG)

    useStore.getState().removeLabel(id)
    release()
    await pending

    expect(labelOf(id)).toBeUndefined()
  })

  test('a user-chosen icon wins over the answer', async () => {
    const release = pendingAnswer()
    const id = commit('生日蛋糕')
    const pending = pickLabelIconFor(id, '生日蛋糕', CONFIG)

    useStore.getState().setLabel(id, { icon: 'star' })
    release()
    await pending

    expect(labelOf(id)?.icon).toBe('star')
  })

  test('a label that already has an icon never asks', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      return Response.json({})
    })
    const id = commit('东京旅行')
    useStore.getState().setLabel(id, { icon: 'pin' })

    await pickLabelIconFor(id, '东京旅行', CONFIG)

    expect(calls).toBe(0)
    expect(labelOf(id)?.icon).toBe('pin')
  })

  test('empty text never asks', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      return Response.json({})
    })
    const id = useStore.getState().addLabel(0.5, 0.5)

    await pickLabelIconFor(id, '', CONFIG)

    expect(calls).toBe(0)
    expect(labelOf(id)?.icon).toBeUndefined()
  })
})
