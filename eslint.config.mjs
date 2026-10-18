import antfu, { parserPlain } from '@antfu/eslint-config'
import { plugin as shadcn } from '@shadcn/lint'
import tsParser from '@typescript-eslint/parser'
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect'
import { i18nCoverage } from './scripts/i18n-coverage.mjs'

// Ban comments written in Chinese (CJK ideographs).
const noChineseComment = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      chinese: 'Comments must be written in English; found Chinese character "{{ char }}".',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()
    const cjk = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const char = comment.value.match(cjk)?.[0]
          if (char)
            context.report({ node: comment, messageId: 'chinese', data: { char }, loc: comment.loc })
        }
      },
    }
  },
}

export default antfu({
  type: 'app',
  antislop: true,
  react: true,
  typescript: true,
  // Generated district polygons (scripts/build-districts.mjs): a 5 MB data
  // file, not source. Linting it parses the whole array as code.
  ignores: ['src/data/districts.json'],
}, {
  name: 'local/no-chinese-comment',
  plugins: {
    local: { rules: { 'no-chinese-comment': noChineseComment, 'i18n-coverage': i18nCoverage } },
  },
  rules: {
    'local/no-chinese-comment': 'error',
    'local/i18n-coverage': 'error',
  },
}, {
  // espree-scoped .js/.mjs files break unused-imports/no-unused-vars (it delegates to
  // typescript-eslint's rule, which misreads espree references as type-only usage).
  // Parse plain JS with the TypeScript parser instead.
  files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}, {
  files: ['src/**/*.tsx'],
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { shadcn },
  settings: {
    shadcn: {
      ui: '@/components/ui',
      note: 'Colors must use the design tokens defined in src/index.css (@theme). Raw palette classes and undeclared tokens are lint errors.',
    },
  },
  rules: {
    'shadcn/no-raw-colors': 'error',
    'shadcn/no-unknown-classes': 'error',
    'shadcn/no-restyle': 'error',
  },
}, {
  // components style themselves; restyling checks apply to their consumers
  files: ['src/components/ui/**'],
  rules: {
    'shadcn/no-restyle': 'off',
    'react-refresh/only-export-components': 'off',
  },
}, {
  // https://github.com/NickvanDyke/eslint-plugin-react-you-might-not-need-an-effect
  ...reactYouMightNotNeedAnEffect.configs.recommended,
  name: 'react-you-might-not-need-an-effect/recommended',
}, {
  // antislop no-em-dash scans these globs as plain text (no JS parser needed)
  files: ['**/*.css', '**/*.scss', '**/*.less', '**/*.pcss', '**/*.postcss', '**/*.html', '**/*.htm', '**/*.svelte'],
  languageOptions: {
    parser: parserPlain,
  },
})
