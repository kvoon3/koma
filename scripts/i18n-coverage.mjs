/**
 * `local/i18n-coverage`: keeps the dictionaries in `src/lib/locales` honest.
 *
 * Keys are their English source string (`t('Export')` looks up `'Export'`), so
 * both failure modes are silent at runtime and have to be caught statically:
 *
 * - A key no dictionary defines renders in English, so a typo looks exactly
 *   like an untranslated string.
 * - A dictionary entry no call site passes is dead weight that survives every
 *   refactor that removes its call site.
 *
 * An ESLint rule sees one file at a time, but this check spans the tree: what is
 * `used` comes from every `t('…')` / `<T k="…">` in `src/`, and the dictionaries
 * are their own files. So the project-wide halves are read once, when the
 * config imports this module, and the rule only reports at the node it finds in
 * the file it was handed.
 *
 * Part of `bun run lint`, and so of the pre-commit hook: adding a `t('…')` with
 * no translation is a lint error at that call site, and deleting a call site
 * leaves its entry in the dictionary flagged until the entry goes too.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const LOCALES = join(SRC, 'lib', 'locales')
/** Every locale file lives here, and nothing else does. */
const LOCALE_DIR = '/lib/locales/'

/** The selectors the rule reports through: one per way a key is written down. */
const DICTIONARY_ENTRY = 'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ObjectExpression > Property'
const T_CALL = 'CallExpression[callee.name="t"]'
const T_ELEMENT = 'JSXOpeningElement[name.name="T"]'

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

/** A key line in a dictionary: `'English source': 'translation',`. */
const KEY_LINE = /^\s*'((?:[^'\\]|\\.)*)'\s*:/gm

const files = walk(SRC)
const localeFiles = files.filter(file => file.includes(LOCALE_DIR))
const appFiles = files.filter(file => !file.includes(LOCALE_DIR))

/**
 * Every string literal in the app. A key handed to `t` indirectly (`t(label)`
 * over a table of labels) still has to appear in the source somewhere, so
 * matching against the whole text keeps those entries from looking dead.
 */
const appSource = appFiles.map(file => readFileSync(file, 'utf8')).join('\n')

// A check that cannot see its inputs passes everything, which is the one
// failure mode this rule must not have (the script it replaced had exactly
// that bug): fail the lint run instead of silently reporting nothing.
if (!localeFiles.length || !appSource)
  throw new Error(`[local/i18n-coverage] no dictionaries or no sources under ${SRC}`)

/** locale name → the keys its dictionary defines. */
const dictionaries = new Map(localeFiles.map((file) => {
  const name = file.slice(LOCALES.length + 1).replace(/\.ts$/, '')
  const source = readFileSync(file, 'utf8')
  const keys = new Set([...source.matchAll(KEY_LINE)].map(([, key]) => key.replace(/\\(.)/g, '$1')))
  return [name, keys]
}))

/** `key` in the source form it would have as a `t()` argument, either quote style. */
function isUsed(key) {
  return appSource.includes(`'${key.replace(/'/g, '\\\'')}'`) || appSource.includes(`"${key}"`)
}

/** The string value of a string literal node, or null for anything dynamic. */
function literalString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string')
    return node.value
  return null
}

/** Report a dictionary entry that no `t()` call passes. */
function checkDeadKey(context, node) {
  const key = literalString(node.key)
  if (key != null && !isUsed(key))
    context.report({ node, messageId: 'dead' })
}

/** The locales whose dictionary does not define `key`. */
function absentIn(key) {
  return [...dictionaries.keys()].filter(name => !dictionaries.get(name).has(key))
}

/**
 * Report an entry some other dictionary lacks. Keys reached through a table
 * (`t(label)` over the font names) have no call site to check, so the
 * dictionaries have to agree with each other instead.
 */
function checkParity(context, node) {
  const key = literalString(node.key)
  const absent = key == null ? [] : absentIn(key)
  if (absent.length)
    context.report({ node, messageId: 'untranslated', data: { locales: absent.join(', ') } })
}

/** Report a key that at least one dictionary cannot translate. */
function checkTranslated(context, node, key) {
  const absent = absentIn(key)
  if (absent.length)
    context.report({ node, messageId: 'missing', data: { locales: absent.join(', ') } })
}

export const i18nCoverage = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Keys must exist in every dictionary, and dictionary entries must be used.',
    },
    schema: [],
    messages: {
      missing: 'No dictionary has this key, so it renders in English (missing from {{locales}}).',
      dead: 'No `t()` call passes this key, so the translation is dead weight. Use it or delete it.',
      untranslated: 'This key is not in {{locales}}, so it falls back to English there.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename()

    if (filename.includes(LOCALE_DIR)) {
      const visitor = {}
      visitor[DICTIONARY_ENTRY] = (node) => {
        checkDeadKey(context, node)
        checkParity(context, node)
      }
      return visitor
    }

    // Only `t()` in the app is ours to check; the config, scripts and tests are not translated.
    if (!filename.includes('/src/'))
      return {}

    const visitor = {}
    visitor[T_CALL] = (node) => {
      const key = literalString(node.arguments[0])
      if (key != null)
        checkTranslated(context, node, key)
    }
    visitor[T_ELEMENT] = (node) => {
      const attr = node.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'k')
      const key = literalString(attr?.value)
      if (key != null)
        checkTranslated(context, attr, key)
    }
    return visitor
  },
}
