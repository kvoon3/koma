import { defineConfig } from '@x18n/core'
import komaBraces from './.x18n/braces'

/**
 * x18n owns dictionary health: parity, dead keys, placeholders, empty values,
 * stale translations. Call-site validity belongs to the compiler: `t` takes
 * `TKey` and `bun check` refuses a literal that is not a key, so `missing-key`
 * is off rather than a second, weaker authority. Keys that reach `t` through
 * data (label tables, records) instead of a direct call carry a
 * `// @x18n-keys` marker on their table.
 */
export default defineConfig({
  sourceLocale: 'zh-Hans',
  resources: [
    { pattern: 'src/lib/locales/{locale}.ts' },
  ],
  usage: {
    calls: [
      { callee: 't', types: ['Translate'] },
      { callee: 'T', key: { arg: 0, property: 'k' } },
    ],
  },
  plugins: [komaBraces],
  checks: {
    'missing-key': 'off',
    'placeholder-mismatch': 'error',
    'unused-key': 'error',
    'missing-translation': 'error',
    'empty-translation': 'error',
  },
})
