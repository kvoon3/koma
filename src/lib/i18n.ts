import { useSyncExternalStore } from 'react'
import { zhHans } from './locales/zh-Hans'
import { zhHant } from './locales/zh-Hant'

/**
 * BCP-47 tags for the scripts. `zh-Hant` covers Taiwan / Hong Kong / Macau;
 * `zh-Hans` is Simplified. `en` needs no dictionary because the source
 * strings are English, so missing keys simply fall through to the key.
 */
export type Lang = 'en' | 'zh-Hans' | 'zh-Hant'

/** All tags we read or write. Stored value migrates toward these on first read. */
const ALL_LANGS: readonly Lang[] = ['en', 'zh-Hans', 'zh-Hant']
const LEGACY_ZH = 'zh' as const

/** Legacy stored value is the bare `zh`; rewrite it to the canonical BCP-47 tag. */
function migrateLegacy(stored: string | null): Lang | null {
  if (!stored)
    return null
  if ((ALL_LANGS as readonly string[]).includes(stored))
    return stored as Lang
  if (stored === LEGACY_ZH)
    return prefersTraditional() ? 'zh-Hant' : 'zh-Hans'
  return null
}

/**
 * Does any of the user's preferred languages look like Traditional Chinese?
 * Matches `zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`. Falls through to false when
 * nothing matches.
 */
function prefersTraditional(): boolean {
  return navigator.languages.some((l) => {
    const tag = l.toLowerCase()
    if (tag === 'zh' || tag.startsWith('zh-'))
      return tag.includes('-hant') || tag.includes('-tw') || tag.includes('-hk') || tag.includes('-mo')
    return false
  })
}

/**
 * Does any preferred language look like any Chinese at all? Used for the
 * first-run default when no preference is stored.
 */
function prefersAnyChinese(): boolean {
  return navigator.languages.some(l => l.toLowerCase().startsWith('zh'))
}

const KEY = 'lang'
const listeners = new Set<() => void>()
let cached: Lang | null = null

const htmlLang: Record<Lang, string> = {
  'en': 'en',
  'zh-Hans': 'zh-Hans',
  'zh-Hant': 'zh-Hant',
}

function detect(): Lang {
  const migrated = migrateLegacy(localStorage.getItem(KEY))
  if (migrated) {
    // Rewrite the legacy value once so subsequent reads are self-describing.
    if (localStorage.getItem(KEY) !== migrated)
      localStorage.setItem(KEY, migrated)
    return migrated
  }
  return prefersTraditional() ? 'zh-Hant' : prefersAnyChinese() ? 'zh-Hans' : 'en'
}

/** The active language. Reads storage / the browser on first call. */
export function lang(): Lang {
  if (cached == null) {
    cached = detect()
    document.documentElement.lang = htmlLang[cached]
  }
  return cached
}

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

const dicts: Record<Lang, Record<string, string>> = {
  'en': {},
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
}

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
