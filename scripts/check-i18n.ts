/**
 * Guards the key-is-the-English-string design of `lib/i18n`: a typo in a key
 * falls back to English silently, so compare the dictionaries against the
 * string literals in src/, both ways.
 *
 * Run: bun scripts/check-i18n.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import process from 'node:process'

const files: string[] = []
function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory())
      walk(p)
    else if (/\.tsx?$/.test(p))
      files.push(p)
  }
}
walk('src')

const sources = files.map(f => readFileSync(f, 'utf8'))
const haystack = sources.join('\n')

/** Every locale dictionary the i18n module ships with. */
const locales: Record<string, Record<string, string>> = {}

async function loadLocales() {
  const dir = 'src/lib/locales'
  for (const entry of readdirSync(dir)) {
    if (!/\.ts$/.test(entry))
      continue
    const name = basename(entry, '.ts')
    // Dynamically import each locale; each module exports exactly one
    // `Record<string, string>` constant whose name we discover below.
    const mod = await import(`../${dir}/${entry}`)
    const exports = Object.entries(mod).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
    if (exports.length !== 1) {
      console.error(`${entry}: expected exactly one dictionary export, got ${exports.length}`)
      process.exit(1)
    }
    const [, dict] = exports[0]
    locales[name] = dict as Record<string, string>
  }
}

/** Every literal `t('…')` / `t("…")` / `<T k="…">` key. Dynamic calls can't be read statically. */
const used = new Set<string>()
for (const src of sources) {
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g))
    used.add(m[1].replace(/\\'/g, '\''))
  for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g))
    used.add(m[1])
  for (const m of src.matchAll(/<T\s+k="([^"]+)"/g))
    used.add(m[1])
}

// Strings handed to `t` indirectly (`t(v)` over the help tables, font labels):
// they only need to exist somewhere in src to be reachable.
function inSource(k: string) {
  return haystack.includes(`'${k.replace(/'/g, '\\\'')}'`) || haystack.includes(`"${k}"`)
}

await loadLocales()

let bad = false
for (const [name, dict] of Object.entries(locales)) {
  const translated = new Set(Object.keys(dict))
  const missing = [...used].filter(k => !translated.has(k)).sort()
  const dead = [...translated].filter(k => !used.has(k) && !inSource(k)).sort()
  if (missing.length) {
    bad = true
    console.error(`${name}: untranslated keys (add to the dictionary):\n  ${missing.join('\n  ')}`)
  }
  if (dead.length) {
    bad = true
    console.error(`${name}: dead dictionary entries (key not found in src):\n  ${dead.join('\n  ')}`)
  }
}

if (bad)
  process.exit(1)

const locList = Object.keys(locales).join(', ')
console.log(`i18n ok: ${used.size} literal keys, ${Object.keys(locales).length} locale(s) [${locList}]`)
