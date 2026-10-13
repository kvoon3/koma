# 004 -- Fade photos in when they finish decoding

- **Status**: TODO
- **Commit**: 257585e
- **Severity**: LOW (additive missed opportunity)
- **Category**: Missed opportunities (AUDIT.md §8) -- preventing a jarring change
- **Estimated scope**: 3 files, 3 edits

## Problem

Photos pop into existence. The decode pipeline is async (`usePreview` / `useThumb` in `src/hooks.ts` render nothing until the URL resolves), so the moment decoding finishes the image mounts at full opacity, hard-swapping whatever stood in its place:

- Placed pane photo -- `src/components/Pane.tsx:678-692`: the `<img ... className="block max-w-none will-change-transform" ...>` mounts instantly over the "Loading…" placeholder (`:697`), which unmounts in the same frame.
- Library thumbnail -- `src/components/Library.tsx:86`: `{url ? <img src={url} ... className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" /> : <span className="block h-full w-full" />}` -- thumbnail pops over the flat `bg-thumb-bg`.

Every photo placement (tens per session) and every cold-start library scroll hits this. A short opacity bridge is the fix: content-replacing-content reads as continuous when the incoming side fades in. Opacity only -- no transform, so it composes with the pan/zoom `transform` already on the pane img and survives the app-wide reduced-motion policy (opacity fades are kept by the global block).

## Target

A shared component class in `src/index.css` (@layer components, next to `.swap-ghost`):

```css
  /* Decoded-photo entrance: bridges the placeholder → image swap. Opacity
     only, so it composes with the pan/zoom transform and the app-wide
     reduced-motion block keeps it as a fade. */
  .photo-in {
    transition: opacity 200ms var(--ease-out);

    @starting-style {
      opacity: 0;
    }
  }
```

`@starting-style` fires on element insertion -- exactly the decode moment -- with zero JS. The 200ms `--ease-out` matches an entrance (starts fast), and 200ms sits between the popup scale (160) and the drawer (450): content appearing deserves a calmer beat than UI.

## Repo conventions to follow

- Component classes for multi-property/animated CSS live in `@layer components` in `src/index.css` -- exemplar `.swap-ghost` + `@keyframes swap-ghost-in` (~lines 322-328), which also uses `var(--ease-out)`.
- This repo has no `@starting-style` usage yet; Base UI's `data-starting-style` idiom is its JSX equivalent, so this extends an existing pattern rather than inventing one.
- Do NOT add the class to sticker images or the sticker-maker preview (separate surfaces, separate plan if ever).

## Steps

1. `src/index.css` -- add the `.photo-in` block above inside `@layer components` (place it directly after the `.swap-ghost` rule).
2. `src/components/Pane.tsx:683` -- placed pane photo img. Change:
```txt
   className = 'block max-w-none will-change-transform'
   ```
   to:
```txt
   className = 'photo-in block max-w-none will-change-transform'
   ```
3. `src/components/Library.tsx:86` -- thumbnail img. Change:
```txt
   {url ? <img src={url} alt="" draggable={false} className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
   ```
   to:
```txt
   {url ? <img src={url} alt="" draggable={false} className="photo-in block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
   ```

The transition lives on the img, NOT on the wrapper: the wrapper's `transition-opacity duration-[150ms]` (`Pane.tsx:675`) drives the carried-dim state and must be untouched.

## Boundaries

- Do NOT touch `Pane.tsx:675` (carried dim), the "Loading…" placeholder (`:697`), or any handler.
- Do NOT animate transform/position -- opacity only.
- Do NOT add the class to sticker imgs (`StickerView`), `WorkspaceGrid` cell previews, or `StickerMakerDialog`'s preview.
- Do NOT add exit animations -- a removed photo may vanish instantly.
- If the verbatim fragments differ (drift since commit 257585e), STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit && npx vite build` -- must pass. `grep -rn "photo-in" src/` returns exactly 3 lines.
- **Feel check** (`bun run dev`, then clear caches via DevTools → Network → Disable cache + hard reload so decodes are slow enough to see):
  - Drop a photo into an empty pane: "Loading…" is replaced by the image fading in over ~200ms -- reads as one continuous appearance, not a pop; the pan/zoom drag on the fresh photo must feel unchanged (no transform interference).
  - Open the library cold: thumbnails fade in as they decode (naturally staggered by decode timing -- no artificial stagger).
  - Long-press swap (carry a photo): the carried ghost and the dimmed original still behave exactly as before -- the fade must not double up with the wrapper's 150ms dim.
  - Immediately press `G` mid-fade (grid morph): the view-transition snapshot may catch a half-faded image -- acceptable, transient; confirm it doesn't linger.
  - `prefers-reduced-motion: reduce`: the fade still plays (opacity is preserved by the global block) -- correct per policy; nothing to change.
- **Done when**: placed photos and library thumbs fade in on decode with zero interference in pan/zoom/swap; typecheck/build/lint green.
