import { flushSync } from 'react-dom'

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

/**
 * Run a synchronous DOM change as a View Transition with no choreography of
 * its own. Elements it moves must already carry the same view-transition-name
 * in both snapshots, as the grid cells' persistent `ws-<id>` does. Reduced
 * motion or a missing API applies the change synchronously.
 */
export function runViewTransition(apply: () => void) {
  if (!document.startViewTransition || prefersReducedMotion()) {
    apply()
    return
  }
  const vt = document.startViewTransition(() => {
    // eslint-disable-next-line react/dom-no-flush-sync -- DOM must match the store before the new snapshot is captured
    flushSync(apply)
  })
  void vt.finished.catch(() => {})
}

/* The newest runPaneMorph owns the cleanup: a rapid second call skips the
   first transition, and letting the first one's cleanup run would strip the
   names the second has just tagged on the same panes. */
let paneMorphRun = 0

/**
 * Run a pane-count change (split, duplicate, close, close others/empty) as a
 * View Transition choreographed after Omarchy's Hyprland setup
 * (default/hypr/looknfeel.lua): the pane the change creates pops in from 87%
 * of its size (windowsIn `popin 87%`), the ones `removed` lists pop out fast
 * and linear (windowsOut), and every survivor glides to its new rect with
 * easeOutQuint, which is the codebase's --ease-out verbatim. Roles ride on
 * view-transition-class (pane-in / pane-out / pane-move); names are
 * `pane-<id>` for the transition only, since persistent names would carve
 * the panes out of the grid ⇄ editor `ws-<id>` morph (same rule as the
 * swap's photo names). While a morph runs the root carries `data-pane-morph`,
 * which freezes the tools dock's own fade: the new snapshot must capture the
 * dock at its final opacity so the transition's root crossfade fades it in
 * step with the panes, instead of a CSS transition racing underneath the
 * overlay and finishing behind it. Callers early-return on no-ops before
 * this runs, or a nothing-change would still pop its "removed" panes.
 * Reduced motion or a missing API keeps the synchronous change.
 */
export function runPaneMorph(removed: readonly string[], apply: () => void) {
  if (!document.startViewTransition || prefersReducedMotion()) {
    apply()
    return
  }
  const run = ++paneMorphRun
  const gone = new Set(removed)
  const before = new Map<string, HTMLElement>()
  // The old snapshot has to carry the names and roles, so set them before
  // the capture.
  for (const el of document.querySelectorAll<HTMLElement>('[data-pane-id]')) {
    const id = el.dataset.paneId!
    before.set(id, el)
    el.style.viewTransitionName = `pane-${id}`
    el.style.viewTransitionClass = gone.has(id) ? 'pane-out' : 'pane-move'
  }
  document.documentElement.dataset.paneMorph = ''
  const vt = document.startViewTransition(() => {
    // The new snapshot is captured the instant this callback returns, so the
    // DOM must already match the store; flushSync forces that.
    // eslint-disable-next-line react/dom-no-flush-sync -- DOM must match the store before the new snapshot is captured
    flushSync(apply)
    // Panes the change created exist only now: tag them so they pop in
    // instead of blinking in.
    for (const el of document.querySelectorAll<HTMLElement>('[data-pane-id]')) {
      const id = el.dataset.paneId!
      if (!before.has(id)) {
        el.style.viewTransitionName = `pane-${id}`
        el.style.viewTransitionClass = 'pane-in'
      }
    }
  })
  // Drop the names and roles once the morph is done; an interrupted
  // transition rejects, hence the catch.
  void vt.finished.finally(() => {
    if (run !== paneMorphRun)
      return
    delete document.documentElement.dataset.paneMorph
    for (const el of document.querySelectorAll<HTMLElement>('[data-pane-id]')) {
      el.style.viewTransitionName = ''
      el.style.viewTransitionClass = ''
    }
  }).catch(() => {})
}
