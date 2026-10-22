/// <reference types="bun" />
import type { TKey } from './locales/zh-Hans'
import { describe, expect, test } from 'bun:test'
import { t } from './i18n'

/**
 * The compiler is the call-site gate: `t` takes `TKey`, not `string`. These
 * calls are never executed; each `@ts-expect-error` is the assertion. If `t`
 * ever accepts a plain string again the directives go unused and `bun check`
 * fails. The fake key reaches `t` through a variable and a table entry on
 * purpose, so the i18n scanner's literal regexes cannot mistake it for a call
 * site.
 */
function rejectedByTheCompiler() {
  const notAKey: string = 'Not a translation key'
  // @ts-expect-error a plain string is not a dictionary key
  t(notAKey)

  const table: Record<string, string> = { entry: 'Not a translation key' }
  // @ts-expect-error a string-valued table entry is not a dictionary key
  t(table.entry)
}

describe('t is typed against the key universe', () => {
  test('a literal key is accepted', () => {
    const key: TKey = 'Help'
    expect(key).toBe('Help')
  })

  test('the rejected cases stay in the compiler', () => {
    expect(rejectedByTheCompiler).toBeInstanceOf(Function)
  })
})
