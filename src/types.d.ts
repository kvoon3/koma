declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string | undefined
  }
}

declare module '@tanstack/history' {
  interface HistoryState {
    /** The overview stamps this on the groups entry; Done then goes Back. */
    fromOverview?: boolean
  }
}

export {}
