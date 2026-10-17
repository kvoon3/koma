/// <reference types="bun" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { zhHans } from './locales/zh-Hans'
import { zhHant } from './locales/zh-Hant'

/**
 * Pins the i18n dictionaries to the call sites.
 *
 * `local/i18n-coverage` (scripts/i18n-coverage.mjs) enforces this at lint time;
 * this test enforces the same rules on every `bun test` run, so a dictionary
 * edit that removes or renames a key fails here too. Both failure modes are
 * silent at runtime: a key no dictionary defines renders in English (a typo is
 * indistinguishable from an untranslated string), and a dictionary entry no
 * call site passes is dead weight that outlives its refactor.
 *
 * A key can reach the translate call as a literal (first argument, either
 * quote style, or the k attribute of the T element) or through a variable over
 * a table (the dock's labels): the second kind still has to appear in the
 * source as a string literal, exactly the rule the lint plugin uses. This
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
const dictionaries: Record<string, Record<string, string>> = { 'zh-Hans': zhHans, 'zh-Hant': zhHant }

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

  test('every literal handed to t() is translated in both dictionaries', () => {
    const missing: string[] = []
    for (const key of literalKeys) {
      for (const [lang, dict] of Object.entries(dictionaries)) {
        if (!dict[key])
          missing.push(`${lang}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('both dictionaries define the same keys', () => {
    const hans = Object.keys(zhHans).sort()
    const hant = Object.keys(zhHant).sort()
    expect(hans.filter(k => !(k in zhHant))).toEqual([])
    expect(hant.filter(k => !(k in zhHans))).toEqual([])
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
