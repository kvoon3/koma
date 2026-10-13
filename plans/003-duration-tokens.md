# 003 -- Introduce duration tokens and consolidate the 13 hand-typed values

- **Status**: TODO
- **Commit**: 257585e
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens (AUDIT.md §7) + Easing (§2, bare `ease` fixes)
- **Estimated scope**: ~20 files, ~66 duration sites; mechanical find-replace per the mapping table

## Problem

`src/index.css` defines easing tokens (`--ease-out`, `--ease-in-out`, `--ease-drawer`) but **no duration tokens**. Every duration is a hand-typed arbitrary value, and there are 13 distinct ones, with three near-duplicate clusters that nobody chose: 120/125 (hover vs tooltip), 140/150/160 (dialog exits vs toasts vs popups), 250/260 (theme fade vs grid morph -- both in the same file). Bare `ease` also survives in three spots of the swap machinery (`src/index.css:270, 295-296, 304`): the landing wash is pure `ease`, and the hold-ring pairs `var(--ease-out)` with bare `ease` in one list (295-296) and with `linear` in the other (304) -- one component, two curve vocabularies.

This plan also folds in those three bare-`ease` fixes -- the lines are being edited anyway.

## Target

New tokens on `:root` in `src/index.css`, immediately below the existing ease tokens, same comment style:

```css
  /* Motion durations. Consumed as duration-(--dur-fast) etc. Scale:
     fast = hover/press/color + popup exits · surface = popup/toast enters +
     settle transitions · dialog = dialog enters · morph = view transitions +
     the tools panel · drawer = drawer enter/exit. */
  --dur-fast: 120ms;
  --dur-surface: 160ms;
  --dur-dialog: 180ms;
  --dur-morph: 260ms;
  --dur-drawer: 450ms;
```

Consolidation rules (value → token), chosen so deliberate asymmetry survives: dialog enter 180 stays 180 while its exit 140 becomes `--dur-fast` (120) -- enter stays deliberate, exit gets crisper, matching the menus' 160/120 pair.

## Mapping table (every site, verified at commit 257585e)

Tailwind consumption syntax: `duration-(--dur-fast)` etc. (paren = var reference, matching the existing `ease-(--ease-out)` usage).

**120ms → `duration-(--dur-fast)`** -- 24 sites, mechanical replace of the fragment `duration-[120ms]` (leave every other class in the string untouched):
`ui/button.tsx:38` (dialogButton -- plus the transition list added by plan 001) · `ui/field.tsx:100` (`data-ending-style:duration-[120ms]`) · `ui/menu.tsx:28` (same) · `FloatActions.tsx:16` · `Footer.tsx:62` · `HelpOverlay.tsx:65` · `Library.tsx:59` · `Pane.tsx:23,119,145,288,305,515,541` · `SettingsDrawer.tsx:28,29,39` · `Stage.tsx:31,348,378,394` · `TopBar.tsx:22,31` (the exit fragment) · `WorkspaceGrid.tsx:33`. Plus every `duration-[120ms]` added by plan 001 (buttonBase, Toast.Close, swatch, empty-pane picker).

**125ms → `--dur-fast`** -- `ui/tip.tsx:10`: `duration-[125ms]` → `duration-(--dur-fast)`.

**140ms, dialog exits → `--dur-fast`** (140→120, deliberate) -- replace `data-ending-style:duration-[140ms]` → `data-ending-style:duration-(--dur-fast)` at: `ConfirmDialog.tsx:25,26` · `CropDialog.tsx:20,21` · `HelpOverlay.tsx:61,62` · `StickerMakerDialog.tsx:328,329` · `WeChatGuard.tsx:72,73,100,107`.

**140ms, hover/indicator reveals → `--dur-fast`** -- replace `duration-[140ms]` → `duration-(--dur-fast)` at: `Pane.tsx:553,776,960,1614` · `Stage.tsx:364`.

**150ms → `--dur-surface`** (150→160): `Pane.tsx:675` (`duration-[150ms]`) · `ToastHost.tsx:11,12` (unbracketed `duration-150` → `duration-(--dur-surface)`) · `index.css:327` (`animation: swap-ghost-in 150ms var(--ease-out);` → `swap-ghost-in var(--dur-surface) var(--ease-out)`) · `index.css:295-296` clip-path leg `150ms` → `var(--dur-surface)` (the 302-306 block's 150ms is the opacity *delay*, handled in the bare-`ease` fixes below).

**160ms → `--dur-surface`**: `ui/field.tsx:100` · `ui/menu.tsx:28` · `TopBar.tsx:31` (both the enter fragment AND the keyframe shorthand `animate-[menu-hop_160ms_var(--ease-out)]` → `animate-[menu-hop_var(--dur-surface)_var(--ease-out)]`) · `Stage.tsx:24` · `WorkspaceGrid.tsx:218,479`.

**180ms → `--dur-dialog`** (dialog enters, `duration-[180ms]`): `ConfirmDialog.tsx:25,26` · `CropDialog.tsx:20,21` · `HelpOverlay.tsx:61,62` · `StickerMakerDialog.tsx:328,329` · `WeChatGuard.tsx:72,73,100,107`.

**250ms → `--dur-morph`** (250→260): `index.css:422` (`animation-duration: 250ms;` → `animation-duration: var(--dur-morph);`).

**260ms → `--dur-morph`**: `index.css:407` (`animation-duration: 260ms;` → `animation-duration: var(--dur-morph);`) · `Stage.tsx:23` (`duration-[260ms]`).

**450ms → `--dur-drawer`**: `LibraryDrawer.tsx:128,130` · `SettingsDrawer.tsx:91,93` (`duration-[450ms]`).

**Bare-`ease` fixes (same file, same lines)** -- `src/index.css`:
- Line 270: `transition: opacity 120ms ease;` → `transition: opacity var(--dur-fast) var(--ease-out);`
- Lines 295–296 (resting): `clip-path 150ms var(--ease-out), opacity 120ms ease;` → `clip-path var(--dur-surface) var(--ease-out), opacity var(--dur-fast) var(--ease-out);`
- Lines 302–306 (armed): `clip-path 500ms linear, opacity 120ms ease 150ms;` → `clip-path 500ms linear, opacity var(--dur-fast) var(--ease-out) var(--dur-surface);` (the 500ms linear hold-wipe and its 150ms delay are deliberate; delay 150→160 is imperceptible)

**Explicitly out of scope (leave as-is):** `duration-[calc(var(--drawer-swipe-strength)*400ms)]` ×4 (gesture-derived physics value) · `[animation-duration:900ms]` spinners ×3 · `animate-[live-blink_1.4s_...]` (continuous indicator) · WAAPI `{ duration: 200 }` at `Pane.tsx:837` (documented JS literal) · dnd-kit `dropAnimation` duration (JS object) · the 500ms hold wipe · `animation-duration: 0.01ms` in the reduced-motion block · `duration-0`/`data-swiping:duration-0` (gesture overrides).

## Repo conventions to follow

- Tokens live on `:root` with a comment naming their consumers -- exemplar, `src/index.css:62-63`:
  ```css
  /* Motion: strong UI curves. Consumed as ease-(--ease-out) / ease-(--ease-drawer). */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  ```
- Consumption uses Tailwind v4 paren syntax: `ease-(--ease-out)` → durations become `duration-(--dur-fast)`.
- Do NOT reorder or reformat class strings beyond the duration fragment; keep the space before every `${…}` interpolation (repo rule).

## Steps

1. Add the five tokens to `:root` in `src/index.css` (target block above).
2. Apply the bare-`ease`/clip-path/keyframe edits in `src/index.css` (lines 270, 295–296, 302–306, 327, 407, 422).
3. Work through the mapping table file by file, top to bottom; each site is a one-fragment replace. Use `grep -rn "duration-\[\|duration-150" src/` before starting and after finishing -- before: **53 lines** (68 sites; 15 lines carry two values, and grep counts lines once). After: the only remaining matches are the 4 `duration-[calc(var(--drawer-swipe-strength)*400ms)]` lines.
4. Run the app and click through every surface in the verification list.

## Boundaries

- Do NOT change curves other than the three bare-`ease` fixes (all other curves already match the token set).
- Do NOT touch durations tagged out-of-scope above.
- Do NOT introduce spring/physics values or change the drawer's character.
- Do NOT edit `src/components/Pane.tsx:837` or `WorkspaceGrid.tsx:445` JS literals.
- If any verbatim fragment differs (drift since commit 257585e), STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit && npx vite build` -- must pass. `bun run lint` -- must pass. `grep -rn "duration-\[" src/ | grep -v calc` must return **nothing** (the spinners use `[animation-duration:900ms]` -- colon syntax, never matched by `duration-\[`). `grep -rn " ease;" src/index.css` must return nothing.
- **Feel check** (this plan changes three feel-relevant values -- verify each):
  - Dialog exit (Confirm on the reset button): close a confirm dialog -- the 140→120ms exit should read crisper, never abrupt. If the exit feels clipped, STOP and report instead of reverting silently.
  - Toast: enter now 160ms (was 150) -- should be indistinguishable.
  - Tooltip (`ui/tip.tsx`): 125→120ms -- indistinguishable; hover the split chip and the resize handle to confirm.
  - Swap-hold ring (touch or menu-Move): the wipe still fills over 500ms linear; its fade-in still arrives late (~160ms) -- unchanged rhythm.
  - Grid⇄editor morph and theme toggle: unchanged (both now read the same 260ms token -- verify the theme fade doesn't feel slower; +10ms is intentional consolidation).
  - `prefers-reduced-motion: reduce`: everything still snaps per the global block; nothing regressed.
- **Done when**: the duration vocabulary is exactly {fast 120, surface 160, dialog 180, morph 260, drawer 450} + deliberate literals {400-calc, 500 linear, 900 spin, 1.4s blink, WAAPI 200, dnd 160}; typecheck/build/lint green.
