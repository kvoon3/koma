/// <reference types="bun" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { ja } from './locales/ja'
import { zhHans } from './locales/zh-Hans'
import { zhHant } from './locales/zh-Hant'

/**
 * Pins the i18n dictionaries to the call sites where types stop short.
 *
 * The compiler owns the main contract: `zh-Hans` is the key universe, `t`
 * takes only a `TKey`, and the other dictionaries are `Record<TKey, string>`.
 * That makes a table-driven call such as `t(item.label)` a compile error when
 * its value is not a key, and a missing translation a compile error too.
 *
 * This scan owns the rest: a dictionary entry no call site uses any more is
 * dead weight that outlives its refactor, and the cross-dictionary and literal
 * call-site checks stay as a second opinion and as the pre-commit hook's
 * standalone check. `bun scripts/i18n-coverage.mjs` runs it while the edit is
 * still one file; this test repeats it on every `bun test`, which is what puts
 * the check in CI.
 *
 * A key can reach the translate call as a literal (first argument, either
 * quote style, or the k attribute of the T element) or through a variable over
 * a table (the dock's labels): the second kind still has to appear in the
 * source as a string literal, exactly the rule the i18n scan uses. This
 * comment deliberately spells none of those forms out, since the scan reads
 * every file, this one included.
 */

const SRC = join(import.meta.dir, '..')
const LOCALES = join(SRC, 'lib', 'locales')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory())
      return walk(path)
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

const appFiles = walk(SRC).filter(file => !file.startsWith(LOCALES))
const appSource = appFiles.map(file => readFileSync(file, 'utf8')).join('\n')

/** The string value of a quoted literal's body, escapes resolved. */
const unescape = (body: string) => body.replace(/\\(.)/g, '$1')

/** Every string literal passed to `t(…)`, in either quote style. */
function tCallKeys(source: string): string[] {
  const keys: string[] = []
  for (const m of source.matchAll(/(?<![\w.$])t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g))
    keys.push(unescape(m[1] ?? m[2]!))
  return keys
}

/** Every T element carrying a k attribute, in the tree. */
function tElementKeys(source: string): string[] {
  const keys: string[] = []
  for (const m of source.matchAll(/<T\s[^>]*?\bk=(?:'([^']*)'|"([^"]*)")/g))
    keys.push(unescape(m[1] ?? m[2]!))
  return keys
}

const literalKeys = new Set([...tCallKeys(appSource), ...tElementKeys(appSource)])
const dictionaries: Record<string, Record<string, string>> = { 'zh-Hans': zhHans, 'zh-Hant': zhHant, 'ja': ja }

/** Does this key appear anywhere in the app source as a string literal? */
function reachable(key: string): boolean {
  return appSource.includes(`'${key.replace(/'/g, '\\\'')}'`) || appSource.includes(`"${key}"`)
}

describe('i18n dictionaries vs. call sites', () => {
  test('the scan sees both halves (a blind check would pass everything)', () => {
    expect(appFiles.length).toBeGreaterThan(50)
    expect(literalKeys.size).toBeGreaterThan(100)
    expect(Object.keys(zhHans).length).toBeGreaterThan(100)
  })

  test('every literal handed to t() is translated in all dictionaries', () => {
    const missing: string[] = []
    for (const key of literalKeys) {
      for (const [lang, dict] of Object.entries(dictionaries)) {
        if (!dict[key])
          missing.push(`${lang}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('all dictionaries define the same keys', () => {
    const keys = Object.keys(zhHans).sort()
    for (const [lang, dict] of Object.entries(dictionaries))
      expect({ lang, keys: Object.keys(dict).sort() }).toEqual({ lang, keys })
  })

  test('no dictionary entry is dead weight', () => {
    const dead: string[] = []
    for (const [lang, dict] of Object.entries(dictionaries)) {
      for (const key of Object.keys(dict)) {
        if (!literalKeys.has(key) && !reachable(key))
          dead.push(`${lang}: ${key}`)
      }
    }
    expect(dead).toEqual([])
  })

  test('no dictionary translation is empty', () => {
    const empty: string[] = []
    for (const [lang, dict] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        if (!value.trim())
          empty.push(`${lang}: ${key}`)
      }
    }
    expect(empty).toEqual([])
  })
})
