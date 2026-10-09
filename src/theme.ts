const KEY = 'theme'

export type ThemePref = 'auto' | 'light' | 'dark'

const listeners = new Set<() => void>()
let osQuery: MediaQueryList | null = null

function notify() {
  listeners.forEach(l => l())
}

function osDark() {
  return (osQuery ??= window.matchMedia('(prefers-color-scheme: dark)')).matches
}

export function applyTheme() {
  const pref = storedPref()
  const dark = pref === 'dark' || ((pref === 'auto' || pref == null) && osDark())
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0a' : '#ffffff')
  notify()
}

function storedPref(): ThemePref | null {
  const v = localStorage.getItem(KEY)
  return v === 'auto' || v === 'light' || v === 'dark' ? v : null
}

export function subscribeTheme(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function isDarkSnapshot() {
  return document.documentElement.classList.contains('dark')
}

export function toggleDark() {
  const next = !isDarkSnapshot()
  localStorage.setItem(KEY, next === osDark() ? 'auto' : next ? 'dark' : 'light')
  applyTheme()
}

export function initTheme() {
  const legacy = localStorage.getItem('collage:theme')
  if (legacy === 'light' || legacy === 'dark')
    localStorage.setItem(KEY, legacy)
  localStorage.removeItem('collage:theme')
  applyTheme()
  osQuery = window.matchMedia('(prefers-color-scheme: dark)')
  osQuery.addEventListener('change', applyTheme)
}
