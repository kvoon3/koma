import { flushSync } from 'react-dom'

/**
 * Wrap a view switch (grid ⇄ editor) in a same-document View Transition so
 * the cell and the stage canvas morph into each other. No-op (plain update)
 * where the API is unsupported or the user prefers reduced motion.
 */
export function viewTransition(update: () => void) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }
  // eslint-disable-next-line react/dom-no-flush-sync -- required pattern: force the DOM update inside the startViewTransition callback so the snapshot pairs with the new tree.
  document.startViewTransition(() => flushSync(update))
}
