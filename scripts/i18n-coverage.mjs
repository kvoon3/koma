/**
 * Keeps the dictionaries in `src/lib/locales` honest where the compiler cannot.
 *
 * `zh-Hans.ts` is the key universe: `TKey` is its literal key union, `t` takes
 * only a `TKey`, and `zh-Hant` / `ja` are typed `Record<TKey, string>`. The
 * compiler therefore owns call-site validity and cross-dictionary parity, for
 * table-driven calls such as `t(item.label)` as much as for literals.
 *
 * This scan owns what types cannot see:
 *
 * - A key no call site uses any more: dead weight that survives the refactor
 *   that removed its call site.
 * - Cross-dictionary parity, as a second opinion on the type constraint.
 * - The literal call-site forms, as a cheap backstop the pre-commit hook can
 *   run alone; the compiler is the authority, not this regex.
 *
 * This is a project-wide scan, not an ESLint rule: ESLint `--cache` is
 * per-file and would keep a dictionary's "no dead keys" result after a `t()`
 * call elsewhere was deleted. `src/lib/i18nDrift.test.ts` runs the same scan
 * on every `bun test`, so CI catches it; this CLI is what the pre-commit hook
 * calls, and what a quick ad-hoc check runs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const LOCALES = join(SRC, 'lib', 'locales')

const KEY_LINE = /^\s*'((?:[^'\\]|\\.)*)'\s*:/gm
const T_CALL = /(?<![\w.$])t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
const T_ELEMENT = /<T\s[^>]*?\bk=(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory())
      files.push(...walk(path))
    else if (/\.tsx?$/.test(path))
      files.push(path)
  }
  return files
}

function unescape(body) {
  return body.replace(/\\(.)/g, '$1')
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length
}

function rel(path) {
  return relative(ROOT, path)
}

function loadTree() {
  const files = walk(SRC)
  const localeFiles = files.filter(file => file.startsWith(`${LOCALES}/`) || file.startsWith(`${LOCALES}\\`))
  const appFiles = files.filter(file => !localeFiles.includes(file))
  const appSource = appFiles.map(file => readFileSync(file, 'utf8')).join('\n')
  if (!localeFiles.length || !appSource)
    throw new Error(`[i18n-coverage] no dictionaries or no sources under ${SRC}`)
  const dictionaries = new Map(localeFiles.map((file) => {
    const name = file.slice(LOCALES.length + 1).replace(/\.ts$/, '')
    const source = readFileSync(file, 'utf8')
    const keys = new Set([...source.matchAll(KEY_LINE)].map(([, key]) => unescape(key)))
    return [name, { file, source, keys }]
  }))
  return { appFiles, appSource, dictionaries }
}

function dictionaryIssues(dictionaries, isUsed) {
  const issues = []
  for (const [name, dict] of dictionaries) {
    KEY_LINE.lastIndex = 0
    for (const match of dict.source.matchAll(KEY_LINE)) {
      const key = unescape(match[1])
      const where = `${rel(dict.file)}:${lineAt(dict.source, match.index)}`
      if (!isUsed(key))
        issues.push(`${where}  No \`t()\` call passes '${key}', so the translation is dead weight. Use it or delete it.`)
      const absent = [...dictionaries.keys()].filter(other => other !== name && !dictionaries.get(other).keys.has(key))
      if (absent.length)
        issues.push(`${where}  '${key}' is not in ${absent.join(', ')}, so it falls back to English there.`)
    }
  }
  return issues
}

function callSiteIssues(appFiles, dictionaries) {
  const issues = []
  const absentIn = key => [...dictionaries.keys()].filter(name => !dictionaries.get(name).keys.has(key))
  for (const file of appFiles) {
    const source = readFileSync(file, 'utf8')
    for (const re of [T_CALL, T_ELEMENT]) {
      re.lastIndex = 0
      for (const match of source.matchAll(re)) {
        const key = unescape(match[1] ?? match[2])
        const absent = absentIn(key)
        if (!absent.length)
          continue
        issues.push(`${rel(file)}:${lineAt(source, match.index)}  No dictionary has '${key}', so it renders in English (missing from ${absent.join(', ')}).`)
      }
    }
  }
  return issues
}

export function collectI18nIssues() {
  const { appFiles, appSource, dictionaries } = loadTree()
  const isUsed = key => appSource.includes(`'${key.replace(/'/g, '\\\'')}'`) || appSource.includes(`"${key}"`)
  return [...dictionaryIssues(dictionaries, isUsed), ...callSiteIssues(appFiles, dictionaries)]
}

if (import.meta.main) {
  const issues = collectI18nIssues()
  for (const issue of issues)
    console.error(issue)
  if (issues.length) {
    console.error(`i18n-coverage: ${issues.length} problem${issues.length === 1 ? '' : 's'}`)
    process.exit(1)
  }
}
