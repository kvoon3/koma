import { useEffect, useState } from 'react'

export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`collage:${key}`)
      return raw == null ? initial : (JSON.parse(raw) as T)
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
