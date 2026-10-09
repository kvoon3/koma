import type { Theme } from './store'
import { useEffect } from 'react'
import { useStore } from './store'

const isTheme = (v: unknown): v is Theme => v === 'auto' || v === 'dark' || v === 'light'

export function resolveTheme(pref: Theme, systemDark: boolean): 'dark' | 'light' {
  return pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref
}

export function useTheme() {
  const theme = useStore(s => s.theme)

  useEffect(() => {
    try {
      if (isTheme(theme))
        localStorage.setItem('collage:theme', theme)
    }
    catch {
    }
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      root.dataset.theme = resolveTheme(theme, mq.matches)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}
