/// <reference types="bun" />
/**
 * What every test file starts from, before it loads the store: see the
 * `[test] preload` entry in `bunfig.toml`.
 *
 * Two stand-ins. `runPaneMorph` needs a `document` without the View Transition
 * API, so a board mutation takes the synchronous path it takes in a browser
 * without one. zustand's `persist` needs `window.localStorage`, which bun does
 * not have; this one keeps what it writes (`persisted`), so a test can read the
 * payload a reload would have restored.
 *
 * A preload rather than a block copied into each file: bun shares one process
 * across test files, so a file that imports the store without these in place
 * only worked if some other file happened to run first.
 */

/** The payload `persist` wrote, by key: what the next boot would read back. */
export const persisted = new Map<string, string>()

const storage = {
  getItem: (k: string) => persisted.get(k) ?? null,
  setItem: (k: string, v: string) => void persisted.set(k, v),
  removeItem: (k: string) => void persisted.delete(k),
  clear: () => persisted.clear(),
}

Object.assign(globalThis, {
  document: {
    startViewTransition: undefined,
    querySelectorAll: () => [],
    documentElement: { dataset: {} },
  },
  window: { localStorage: storage },
  localStorage: storage,
})
