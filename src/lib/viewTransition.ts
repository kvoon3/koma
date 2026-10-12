/**
 * The TanStack Router `viewTransition` navigation option for grid ⇄ editor
 * switches, so a grid cell and the stage canvas morph into each other.
 *
 * The router already checks `document.startViewTransition` exists, but it does
 * not honor `prefers-reduced-motion`, so it is disabled here to match the
 * app's previous behavior.
 */
export function viewTransitionOption() {
  return !matchMedia('(prefers-reduced-motion: reduce)').matches
}
