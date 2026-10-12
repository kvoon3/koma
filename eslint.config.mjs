import antfu, { parserPlain } from '@antfu/eslint-config'
import { plugin as shadcn } from '@shadcn/lint'
import tsParser from '@typescript-eslint/parser'
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect'

export default antfu({
  type: 'app',
  antislop: true,
  react: true,
  typescript: true,
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
