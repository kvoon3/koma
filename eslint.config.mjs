import antfu, { parserPlain } from '@antfu/eslint-config'
import { plugin as shadcn } from '@shadcn/lint'
import tsParser from '@typescript-eslint/parser'
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect'

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
  // `inspection: 'full'` scans every line of every linted file. The default
  // (`recent-changes`) only reports a construct sitting on an added line, so
  // old prose stays invisible until it changes. Full makes the gate a property
  // of the tree, not the diff.
  antislop: {
    slop: {
      inspection: 'full',
    },
  },
  react: true,
  typescript: true,
  // TIMING=all: jsdoc is 778ms of 3.9s rule time, so it goes. markdown, yaml
  // and toml are 16ms between them and catch prose problems, so they stay.
  // i18n coverage is a bun script, not a rule: --cache is per-file and cannot
  // see a deleted t() in another file.
  jsdoc: false,
  // Generated district polygons (scripts/build-districts.mjs): a 5 MB data
  // file, not source. Linting it parses the whole array as code.
  ignores: ['src/data/districts.json'],
}, {
  name: 'local/no-chinese-comment',
  plugins: {
    local: { rules: { 'no-chinese-comment': noChineseComment } },
  },
  rules: {
    'local/no-chinese-comment': 'error',
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
