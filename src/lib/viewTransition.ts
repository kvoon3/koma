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

/**
 * True when the user asked for reduced motion. JS-driven motion (WAAPI,
 *  dnd-kit) must check this before animating; CSS is covered by the global
 *  block in index.css.
 */
export function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}
