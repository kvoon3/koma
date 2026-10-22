import type { TKey } from './locales/zh-Hans'
import { useSyncExternalStore } from 'react'
import { ja } from './locales/ja'
import { zhHans } from './locales/zh-Hans'
import { zhHant } from './locales/zh-Hant'

export type { TKey } from './locales/zh-Hans'

/**
 * BCP-47 tags for the interface languages. `zh-Hant` covers Taiwan / Hong
 * Kong / Macau, `zh-Hans` is Simplified Chinese, and `ja` is Japanese. `en`
 * needs no dictionary because the source strings are English, so missing keys
 * simply fall through to the key.
 */
export type Lang = 'en' | 'zh-Hans' | 'zh-Hant' | 'ja'

/** All tags we read or write. Stored value migrates toward these on first read. */
const ALL_LANGS: readonly Lang[] = ['en', 'zh-Hans', 'zh-Hant', 'ja']
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

/** Traditional-script Chinese tags: `zh-Hant`, plus Taiwan / Hong Kong / Macau. */
function isTraditional(tag: string): boolean {
  return tag.includes('-hant') || tag.includes('-tw') || tag.includes('-hk') || tag.includes('-mo')
}

function prefersTraditional(): boolean {
  return navigator.languages.some((l) => {
    const tag = l.toLowerCase()
    return (tag === 'zh' || tag.startsWith('zh-')) && isTraditional(tag)
  })
}

function fromBrowserTag(value: string): Lang | null {
  const tag = value.toLowerCase()
  if (tag === 'en' || tag.startsWith('en-'))
    return 'en'
  if (tag === 'ja' || tag.startsWith('ja-'))
    return 'ja'
  if (tag === 'zh' || tag.startsWith('zh-'))
    return isTraditional(tag) ? 'zh-Hant' : 'zh-Hans'
  return null
}

/**
 * The first preferred language we ship. Order matters: `['ja-JP', 'zh-TW']`
 * means the user wants Japanese, while the reverse means Traditional Chinese.
 */
function preferredLang(): Lang | null {
  for (const value of navigator.languages) {
    const tag = fromBrowserTag(value)
    if (tag)
      return tag
  }
  return null
}

const KEY = 'lang'
const listeners = new Set<() => void>()
let cached: Lang | null = null

const htmlLang: Record<Lang, string> = {
  'en': 'en',
  'zh-Hans': 'zh-Hans',
  'zh-Hant': 'zh-Hant',
  'ja': 'ja',
}

function detect(): Lang {
  const migrated = migrateLegacy(localStorage.getItem(KEY))
  if (migrated) {
    // Rewrite the legacy value once so subsequent reads are self-describing.
    if (localStorage.getItem(KEY) !== migrated)
      localStorage.setItem(KEY, migrated)
    return migrated
  }
  return preferredLang() ?? 'en'
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

const dicts: Record<Lang, Partial<Record<TKey, string>>> = {
  'en': {},
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  'ja': ja,
}

/**
 * Translate a key, which is the English source string, substituting `{name}` vars.
 * An absent translation falls back to the key itself, so a dictionary can lag
 * behind `zh-Hans` at runtime even though the types refuse it at build time.
 */
export function t(key: TKey, vars?: Record<string, string | number>): string {
  let s = dicts[lang()][key] ?? key
  if (vars) {
    for (const k in vars)
      s = s.replaceAll(`{${k}}`, String(vars[k]))
  }
  return s
}

/** The shape of `t`, for code that takes the translator as an argument. */
export type Translate = (key: TKey, vars?: Record<string, string | number>) => string

const keyUniverse = new Set<string>(Object.keys(zhHans))

/**
 * True when a runtime string is a dictionary key. Error messages cross a
 * boundary as plain strings; this lets a caller translate a known one and show
 * an unknown one as it came, without widening `t` back to `string`.
 */
export function isTKey(value: string): value is TKey {
  return keyUniverse.has(value)
}

/** `t`, subscribed: the calling component re-renders when the language changes. */
export function useT(): Translate {
  useLang()
  return t
}
