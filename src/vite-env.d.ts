/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_JEV_API_URL?: string
  /** Vite inlines this into the public bundle, so never ship a secret here. */
  readonly VITE_JEV_API_KEY?: string
}
