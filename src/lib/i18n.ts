import { useSyncExternalStore } from 'react'
import { zh } from './locales/zh'

export type Lang = 'en' | 'zh'

const KEY = 'lang'
const listeners = new Set<() => void>()
let cached: Lang | null = null

const htmlLang: Record<Lang, string> = { en: 'en', zh: 'zh-Hans' }

function detect(): Lang {
  const stored = localStorage.getItem(KEY)
  if (stored === 'en' || stored === 'zh')
    return stored
  return navigator.languages.some(l => l.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

/** The active language. Reads storage / the browser on first call. */
export function lang(): Lang {
  if (cached == null) {
    cached = detect()
    document.documentElement.lang = htmlLang[cached]
  }
  return cached
}

/** The active language, subscribed: re-renders when it changes. */
/** The active language, subscribed: re-renders the caller when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, lang)
}

export function setLang(next: Lang) {
  cached = next
  localStorage.setItem(KEY, next)
  document.documentElement.lang = htmlLang[next]
  listeners.forEach(l => l())
}

export function subscribeLang(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const dicts: Record<Lang, Record<string, string>> = { en: {}, zh }

/**
 * Translate a key, which is the English source string, substituting `{name}` vars.
 * An absent translation falls back to the key itself, so partial dictionaries
 * are fine and English needs no dictionary at all.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[lang()][key] ?? key
  if (vars) {
    for (const k in vars)
      s = s.replaceAll(`{${k}}`, String(vars[k]))
  }
  return s
}

/** `t`, subscribed: the calling component re-renders when the language changes. */
export function useT() {
  useLang()
  return t
}
