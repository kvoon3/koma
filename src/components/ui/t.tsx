import type { TKey } from '@/lib/locales/zh-Hans'
import { createElement, Fragment } from 'react'
import { t, useT } from '@/lib/i18n'

/**
 * A translated string that may carry `**bold**` spans: one key per sentence,
 * so each translation keeps its own word order. The spans alternate, and the
 * split is positional: the children are static, so they need no keys.
 */
export function T({ k, vars }: { k: TKey, vars?: Record<string, string | number> }) {
  useT()
  return createElement(
    Fragment,
    null,
    ...t(k, vars).split('**').map((part, i) => (i % 2 ? createElement('strong', null, part) : part)),
  )
}
