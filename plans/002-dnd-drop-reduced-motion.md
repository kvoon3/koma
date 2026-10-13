# 002 -- Gate the dnd-kit drop glide behind reduced-motion; use the repo curve

- **Status**: TODO
- **Commit**: 257585e
- **Severity**: MEDIUM
- **Category**: Accessibility (AUDIT.md §6) + Cohesion (§7, off-token curve)
- **Estimated scope**: 2 files, 2 edits

## Problem

`DragOverlay`'s drop animation in `src/components/WorkspaceGrid.tsx:445`:

```txt
<DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
```

Two problems:

1. **It bypasses reduced motion.** dnd-kit implements this drop glide through the Web Animations API (`node.animate(...)` inside `@dnd-kit/core`), so the app-wide `@media (prefers-reduced-motion: reduce)` block in `src/index.css` cannot reach it -- the CSS block only zeroes CSS animations/transitions. Under reduced motion, a released grid cell still autonomously glides across the screen. Every other autonomous motion in this app IS gated: the WAAPI ghost return checks `matchMedia` (`src/components/Pane.tsx:826`), the route morph is disabled via `src/lib/viewTransition.ts`. This is the last ungated autonomous motion.
2. **It introduces a fifth off-token curve.** `cubic-bezier(0.2, 0, 0, 1)` exists nowhere in the repo's vocabulary. The token set is `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` (src/index.css). dnd-kit's `easing` option is a JS string and cannot read CSS vars, so the token's literal value is used -- exactly as `src/components/Pane.tsx:831-837` already does for WAAPI, with the same justification comment.

## Target

```txt
<DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
```

`dropAnimation={null}` is dnd-kit's documented way to disable the drop animation; the source cell's own CSS transition (WorkspaceGrid.tsx:479) still settles it instantly-but-smoothly, which is what reduced-motion users asked for: position changes dropped, fades kept.

## Repo conventions to follow

- Runtime reduced-motion checks live as tiny functions that call `matchMedia` at call time -- exemplar `src/lib/viewTransition.ts:9-11`:
```txt
  export function viewTransitionOption() {
    return !matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  ```
- JS motion that cannot read CSS vars inlines the token literal with a comment -- exemplar `src/components/Pane.tsx:830-837`.

## Steps

1. `src/lib/viewTransition.ts` -- append a sibling helper after `viewTransitionOption()`:
```txt
   /**
    * True when the user asked for reduced motion. JS-driven motion (WAAPI,
    *  dnd-kit) must check this before animating; CSS is covered by the global
    *  block in index.css.
    */
   export function prefersReducedMotion() {
     return matchMedia('(prefers-reduced-motion: reduce)').matches
   }
   ```
2. `src/components/WorkspaceGrid.tsx` -- extend the existing import from `../lib/viewTransition` (currently imports `viewTransitionOption`; check the import line near the top of the file and add `prefersReducedMotion`).
3. Same file, line 445 -- replace the verbatim fragment:
```txt
   <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
   ```
   with:
```txt
   <DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
   ```

## Boundaries

- Do NOT touch the sortable cells' CSS transition (`WorkspaceGrid.tsx:479`) -- it is CSS and already covered by the global block.
- Do NOT touch `src/components/Pane.tsx` (its WAAPI gate already exists at :826).
- Do NOT change the 160ms duration or add spring/stagger behavior.
- If line 445 does not match the verbatim fragment (drift since commit 257585e), STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit && npx vite build` -- must pass. `grep -n "0, 0, 1" src/components/WorkspaceGrid.tsx` must return nothing (off-token curve gone).
- **Feel check**:
  - Drag a workspace cell and release: overlay still glides 160ms into its slot with a strong ease-out -- same speed as before, slightly different flavor at the end (crisper settle; verify it does not feel abrupt).
  - DevTools → Rendering → toggle `prefers-reduced-motion: reduce`, drag and release: the overlay must now disappear and the cell snap into place with no autonomous glide (the cell's own opacity/outline fade may still play -- correct).
  - Un-toggle reduced motion and repeat: glide returns.
- **Done when**: the only WAAPI-driven motion in the app is reduced-motion-aware; the repo's curve vocabulary is back to exactly three curves (plus the documented WAAPI literal equal to `--ease-out`).
