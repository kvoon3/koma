# 001 -- Add press feedback to every pressable control

- **Status**: TODO
- **Commit**: 257585e
- **Severity**: HIGH
- **Category**: Physicality & origin (AUDIT.md §3)
- **Estimated scope**: 10 files, ~25 one-line class edits

## Problem

No pressable element in the app has an `:active` state -- the UI never acknowledges a press. Meanwhile menu items DO have press states (`src/components/ui/menu.tsx:16`: `active:bg-chip-on active:text-chip-on-txt`), so the app is inconsistent with itself: rows in a popup acknowledge the press, but the buttons that open the popup do not. Controls are pressed tens of times a day (top bar, tools panel, drawer headers, floating chips).

The fix is transform-only press feedback: `scale(0.97)` -- the same value the app already uses for its lift state (`[data-swap-armed]` in `src/index.css`), so it extends the existing vocabulary. Tailwind v4's `scale-*` utilities set the standalone `scale` CSS property, which composes with (does not overwrite) any `transform` on the same element -- important for the dnd-kit cell and for elements centered with `-translate-x-1/2`.

## Target

Every site below gets **two** changes:

1. Its transition utility widened to include `scale` (so the press eases, not snaps).
2. `active:scale-[0.97]` appended.

Canonical replacement strings (use exactly):

| Current fragment | Replacement |
|---|---|
| `transition-colors duration-[120ms]` | `transition-[background-color,border-color,color,scale] duration-[120ms] active:scale-[0.97]` |
| `transition-opacity duration-[120ms]` | `transition-[opacity,scale] duration-[120ms] active:scale-[0.97]` |
| `transition-opacity duration-[160ms]` | `transition-[opacity,scale] duration-[160ms] active:scale-[0.97]` |
| `transition-colors duration-[140ms]` | `transition-[background-color,border-color,color,scale] duration-[140ms] active:scale-[0.97]` |
| `transition-[opacity,color] duration-[140ms]` | `transition-[opacity,color,scale] duration-[140ms] active:scale-[0.97]` |
| `transition-[transform,opacity,outline-color] duration-[160ms]` | `transition-[transform,scale,opacity,outline-color] duration-[160ms]` (＋ separate `active:scale-[0.97]`, see site 4b) |

**Color-only exception (no scale):** the empty-pane picker button -- it *is* the whole pane; scaling the entire pane on press reads as content moving. It gets a background response instead: `transition-colors duration-[120ms] active:bg-chip-hover`.

## Repo conventions to follow

- Easing/duration tokens live in `src/index.css` on `:root` and are consumed with the paren syntax, e.g. `ease-(--ease-out)`. Keep the literal `duration-[120ms]` values here; a later plan (003) tokenizes durations repo-wide.
- Do NOT add press colors to these classes. Menus keep their `active:bg-chip-on` convention; buttons get scale only. Do not touch `src/components/ui/menu.tsx`.
- Exemplar of an already-correct press state: `src/components/ui/menu.tsx:16`.

## Steps

Every site below is verified verbatim at commit 257585e. Apply the matching canonical replacement; keep every other class untouched.

1. `src/components/ui/button.tsx` -- `buttonBase` (array at lines 5–13, currently has **no** transition and no `active:`). Add two array entries after the `hover:not-disabled:` line:
```txt
   'hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt',
   'transition-[background-color,border-color,color,scale] duration-[120ms]',
   'active:scale-[0.97]',
   'focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1',
   ```
2. `src/components/ui/button.tsx` -- `dialogButton` (line 38): `transition-colors duration-[120ms]` → `transition-[background-color,border-color,color,scale] duration-[120ms]`, and append `'active:scale-[0.97]',` as a new array line after it.
3. `src/components/TopBar.tsx:22` -- `triggerCls`: apply the `transition-colors duration-[120ms]` replacement.
4. `src/components/WorkspaceGrid.tsx`:
   - **a.** Line 33 `snapBtnCls`: apply the `transition-colors duration-[120ms]` replacement.
   - **b.** Line 479–482 SortableCell `<button>` template literal. Replace `transition-[transform,opacity,outline-color] duration-[160ms]` with `transition-[transform,scale,opacity,outline-color] duration-[160ms]`, then append ` active:scale-[0.97]` inside the template literal, immediately before the closing backtick's `${...}` -- **keep one space before the `${`** (repo rule: a token glued to the interpolation is never scanned):
```txt
     className={`relative cursor-pointer touch-none select-none overflow-hidden bg-panel-2 outline-0 transition-[transform,scale,opacity,outline-color] duration-[160ms] active:scale-[0.97] ${
       highlighted ? ' outline-2 outline-txt -outline-offset-2' : ''
     }`}
     ```
     (dnd-kit drives `transform` inline during drag and its inline `transition` overrides the class list then; the `scale` property composes with its inline transform, so nothing conflicts.)
5. `src/components/FloatActions.tsx:16` -- `btnCls`: apply the `transition-colors duration-[120ms]` replacement.
6. `src/components/Stage.tsx`:
   - Line 24 `toolsHandleCls`: apply the `transition-opacity duration-[160ms]` replacement.
   - Line 31 `toolsBtnCls`: apply the `transition-colors duration-[120ms]` replacement.
   - Line 394 canvas resize handle (inline template literal): apply the `transition-colors duration-[120ms]` replacement (it is inside `${...}`-adjacent text; preserve the trailing space before `${sizing …}`).
7. `src/components/Pane.tsx`:
   - Line 23 `splitBtnCls`: apply the `transition-colors duration-[120ms]` replacement.
   - Line 145 ResetRotationButton: apply the `transition-opacity duration-[120ms]` replacement.
   - Line 305 sticker remove ×: apply the `transition-opacity duration-[120ms]` replacement.
   - Line 541 label remove ×: apply the `transition-opacity duration-[120ms]` replacement.
   - Line 706 empty-pane picker: **exception** -- append ` transition-colors duration-[120ms] active:bg-chip-hover` to the className (no scale):
```txt
     className = 'absolute inset-0 grid cursor-pointer place-items-center border-0 bg-transparent p-0 transition-colors duration-[120ms] active:bg-chip-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent'
     ```
   - Line 776 PaneLiveBadge: apply the `transition-colors duration-[140ms]` replacement.
   - Line 960 PaneCloseTool: apply the `transition-[opacity,color] duration-[140ms]` replacement.
8. `src/components/HelpOverlay.tsx:65` -- header `Dialog.Close`: apply the `transition-colors duration-[120ms]` replacement.
9. `src/components/ToastHost.tsx:17` -- `Toast.Close` (no transition today): append `transition-colors duration-[120ms] active:scale-[0.97]` after `text-dim`.
10. `src/components/SettingsDrawer.tsx`:
    - Line 28 `toggle` (Switch.Root): apply the `transition-colors duration-[120ms]` replacement.
    - Line 30 `swatch` (Radio.Root, no transition today): insert `transition-[border-color,scale] duration-[120ms] active:scale-[0.97]` after `border-line-strong`.

## Boundaries

- Do NOT touch `src/components/ui/menu.tsx` (menu rows already have `active:` styles).
- Do NOT change any JSX structure, handlers, or disabled logic -- className strings only.
- Do NOT change durations (140 stays 140, etc.). Plan 003 owns duration values.
- Do NOT add press feedback to Base UI internal surfaces (popups, drawers, toasts themselves) -- only the listed controls.
- Do NOT apply scale to the empty-pane picker (color-only exception above).
- If a class string at a listed file:line does not match the verbatim text above (drift since commit 257585e), STOP and report instead of improvising.

## Verification

- **Mechanical**: `npx tsc --noEmit && npx vite build` -- must pass. `bun run lint` -- must pass. `grep -rn "active:scale-\[0.97\]" src/ | wc -l` should return ≥ 14.
- **Feel check** (run `bun run dev`):
  - Click a top-bar chip, a tools-panel button, and a floating back/reset button: each dips to 0.97 and eases back over ~120ms -- visible but subtle; if it reads as wobble, the value or duration drifted.
  - Click a grid cell: the cell dips without breaking the dnd-kit drag (grab a cell and drag -- the drag must still ride the pointer with no lag or double-transform).
  - Click an empty pane: background tint only, no pane-wide shrink.
  - In DevTools Animations panel at 10% speed: press eases out on release (no snap-back jump), and the scale composes with `-translate-x-1/2` centering on the tools handle (handle must not shift sideways on press).
  - Toggle `prefers-reduced-motion: reduce` (Rendering panel): the press now snaps (no transition) while hover colors still fade -- this matches the app's documented "fewer and gentler" policy; do not "fix" it.
- **Done when**: every listed control visibly acknowledges press; menus unchanged; typecheck/build/lint green.
