---
name: font-subsetting
description: Trim the koma wordmark font and any future bundled face without changing rendering. Use when asked to shrink font bytes, make web fonts load faster, add or change a bundled face, or audit which fonts a route actually loads. Covers the inventory, the hand-run subset script, the structural checks, and the before/after pixel gate.
---

# Font subsetting

The site ships one bundled webfont, the top bar wordmark. All other type is system fonts, or Google Fonts requested at runtime by `src/lib/fonts.ts`. Re-measure that inventory before assuming more faces; the app can change.

## Non-negotiables

- Rendering is the spec. Capture a baseline before touching a font. A nonzero pixel diff is a regression unless the user approves it.
- Keep `font-display` and the CSS fallback stacks exactly as they are.
- Do not add font processing to the build. Run the generator by hand and commit its output.
- Do not add glyphs, files, or unicode ranges a page does not use. Measure the cost before adding Latin-1, Latin Extended-A, CJK, or a second file.
- Report bytes before and after, the pixel diff, and every deviation with its cost.

## 1. Measure the current state

- Find every static font file and every `@font-face`, `font-display`, `unicode-range`, `preload`, and `fontFamily` reference. Check inline component styles too.
- For each face record size, glyph count, cmap, `fvar` axes, GSUB/GPOS features, hinting tables and instructions, `gasp`, name records, and BASE/GDEF/vhea/vmtx.
- Build the app and record page cost. Vite inlines an asset below 4 KB as a data URI, so the font may be part of the CSS with no request. Record raw, gzip and brotli CSS bytes, every font request, and every preload per route.
- Separate runtime fonts from static ones. The Google catalog in `src/lib/fonts.ts` is content-dependent and is not a static subset target.

`references/verify.md` has the inventory, byte-accounting and screenshot commands.

## 2. Audit actual usage

Answer these from source and from the browser, not from what the font contains.

- Characters. The brand face is the literal `koma` (U+0061, U+006B, U+006D, U+006F). The wordmark hides below `sm`.
- Weights and axes. 700 only today. Check one-off overrides and inline `fontFamily` styles.
- Italics. There is no italic face and no italic content. Do not invent one.
- OpenType features. Default kerning only. There is no `font-feature-settings` or `font-variant-*`.
- CSS side effects. There is no `hyphens` rule and no U+2010 today.
- CJK. System stacks today. No CJK subset exists.

If any answer changes, the subset scope changes with it.

## 3. Subset

- Use `scripts/subset-wordmark-font.py`. It fetches the Google endpoint, subsets to `koma`, drops dead tables and name records, keeps `kern`, `gasp` and `post`, recompresses at brotli quality 10, and updates the size and hash in `src/assets/fonts/SOURCE.md`.
- Run `uv run scripts/subset-wordmark-font.py`, then `uv run scripts/subset-wordmark-font.py --check`.
- Rerun when the wordmark text, the CSS `unicode-range`, or the upstream Google Fonts revision changes. The script pins the revision and stops when it moves. The build never runs it.
- Font-tool rules learned here. Keep `post`, because Chromium's OTS rejects a font without it and falls back to Georgia. Keep `gasp`, because it changes antialiasing. Keep GPOS `kern`, because the wordmark pairs are kerned. Pin `head.modified`, or the output hash drifts per run. Keep name records 0, 1, 2, 4, 6 and 14. Check the OFL for a Reserved Font Name before renaming; this upstream has none.
- Splitting into core and extended files. Do this only when a page actually renders characters outside the core. A dead extended file is a cost, not a win. Measure both files before proposing a split.
- Latin-1 and Latin Extended-A. Do not add them unless the face renders those characters today. Adding them is cheap only if they are unused, and it changes the fallback for any future text in that face. Measure the cost and state the rendering change.

## 4. Verify pixels

- Build the baseline from the same seeded content before the swap. Do not touch that baseline.
- Cover the wordmark plus pages with code, accents and curly punctuation, CJK, and components with their own font settings. Include both themes, mobile and desktop widths, and DPR 2 for the wordmark.
- Make captures deterministic. Use reduced motion, freeze the clock, block Google Fonts, wait for images and `document.fonts.ready`, and screenshot with animations disabled.
- Compare the full page and the wordmark crop. Zero differing pixels is the pass. Explain any nonzero diff as a content change, a regression, or sub-pixel rounding.

`references/verify.md` has the Playwright harness pattern and the scenario list.

## 5. Report

- Font bytes before and after, plus the page CSS raw, gzip and brotli bytes and the request and preload counts.
- The pixel-diff result and the scenarios compared.
- Every deviation with its measured cost. Label estimates as estimates.
- The rerun command and the triggers.

## References

- [references/verify.md](references/verify.md): inventory, byte accounting, screenshot harness, current baselines.

## Later

The core font is already inlined in the global stylesheet, because it is under Vite's inline limit. There are no extended files to precache. If a core/extended split is ever added, precache the extended files after idle.