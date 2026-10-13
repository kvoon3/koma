const KEY = 'theme'

export type ThemePref = 'auto' | 'light' | 'dark'

const listeners = new Set<() => void>()
let osQuery: MediaQueryList | null = null
/* Bumped per fade: a transition interrupted by the next toggle must not clear
   the marker the new one is riding (the old one's `finished` settles first). */
let fadeSeq = 0

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
  fadeTheme()
}

/**
 * Apply the swap inside a view transition so the whole page crossfades
 * (light ⇄ dark) instead of cutting. `data-theme-fade` retunes the root
 * snapshots for the length of the transition; see index.css.
 *
 * The fade is opacity only, so it also runs under prefers-reduced-motion,
 * matching the app-wide policy there (color/opacity fades stay, movement
 * goes). The OS-driven change in `initTheme` stays instant on purpose: it can
 * fire mid-gesture, and a frozen snapshot would stall the drag.
 */
function fadeTheme() {
  if (!document.startViewTransition) {
    applyTheme()
    return
  }
  const root = document.documentElement
  root.dataset.themeFade = ''
  const seq = ++fadeSeq
  const vt = document.startViewTransition(applyTheme)
  void vt.finished.finally(() => {
    if (seq === fadeSeq)
      delete root.dataset.themeFade
  }).catch(() => {})
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
