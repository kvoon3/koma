import { useEffect, useState } from 'react'

/** A boolean preference: the only shape this hook persists. */
export function usePersistedBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(`collage:${key}`)
      if (raw == null)
        return initial
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'boolean' ? parsed : initial
    }
    catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(`collage:${key}`, JSON.stringify(value))
    }
    catch {
    }
  }, [key, value])

  return [value, setValue] as const
}
