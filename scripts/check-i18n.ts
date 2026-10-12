/**
 * Guards the key-is-the-English-string design of `lib/i18n`: a typo in a key
 * falls back to English silently, so compare the dictionaries against the
 * string literals in src/, both ways.
 *
 * Run: bun scripts/check-i18n.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { zh } from '../src/lib/locales/zh'

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

const translated = new Set(Object.keys(zh))
const missing = [...used].filter(k => !translated.has(k)).sort()
const dead = [...translated].filter(k => !used.has(k) && !inSource(k)).sort()

if (missing.length)
  console.error(`Untranslated (add to src/lib/locales/zh.ts):\n  ${missing.join('\n  ')}`)
if (dead.length)
  console.error(`Dead dictionary entries (key not found in src):\n  ${dead.join('\n  ')}`)
if (missing.length || dead.length)
  process.exit(1)
console.log(`i18n ok: ${used.size} literal keys, ${translated.size} translations`)
