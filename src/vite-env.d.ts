/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_JEV_API_URL?: string
  /**
   * Local dev only. A production build never reads it; the Worker proxy owns
   * the deployed secret.
   */
  readonly VITE_JEV_API_KEY?: string
}
