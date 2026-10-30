---
name: font-subsetting
description: Trim the koma wordmark font without changing rendering. Use when asked to shrink font bytes, make web fonts load faster, change the bundled wordmark, or audit which fonts a route actually loads. Covers the inventory, the hand-run subset script, the structural checks, and the before/after pixel gate.
---

# Font subsetting

The site ships one bundled webfont, the top bar wordmark. All other type is system fonts, or Google Fonts requested at runtime by `src/lib/fonts.ts`. Re-measure that inventory before assuming more faces.

## Non-negotiables

- Rendering is the spec. Capture a baseline before touching a font. A nonzero pixel diff is a regression unless the user approves it.
- Keep `font-display` and the CSS fallback stacks exactly as they are.
- Do not add font processing to the build. Run the generator by hand and commit its output.
- Do not add glyphs, files, or unicode ranges a page does not use. Measure the cost before adding Latin-1, Latin Extended-A, CJK, or a second file.

## 1. Measure the current state

- Find every static font file and every `@font-face`, `font-display`, `unicode-range`, `preload`, and `fontFamily` reference. Check inline component styles too.
- For each face record size, glyph count, cmap, `fvar` axes, GSUB/GPOS features, hinting tables and instructions, `gasp`, name records, and BASE/GDEF/vhea/vmtx.
- Build the app and record page cost. Vite inlines an asset below 4 KB as a data URI, so the font may be part of the CSS with no request. Record raw, gzip and brotli CSS bytes, every font request, and every preload per route.
- Tailwind's automatic scan reads prose too. `src/index.css` excludes `.claude` and `.agents` so skill text cannot add utilities to the bundle. Re-check when a new prose directory lands.
- Separate runtime fonts from static ones. The Google catalog in `src/lib/fonts.ts` is content-dependent and is not a static subset target.

`references/verify.md` has the inventory, byte-accounting and screenshot commands.

## 2. Audit actual usage

- Characters. The wordmark text lives in `src/assets/fonts/wordmark.json` and the top bar imports it. The wordmark hides below `sm`.
- Weights and axes. 700 only today. Check one-off overrides and inline `fontFamily` styles.
- Italics. There is no italic face and no italic content. Do not invent one.
- OpenType features. Default kerning only. There is no `font-feature-settings` or `font-variant-*`.
- CSS side effects. There is no `hyphens` rule and no U+2010 today.
- CJK. System stacks today. No CJK subset exists.

If any answer changes, the subset scope changes with it.

## 3. Subset

- Use `scripts/subset-wordmark-font.py`. It reads `wordmark.json`, fetches the Google endpoint, subsets to that text, drops dead tables, keeps the pixel and loader-critical tables, and writes the font, the CSS `unicode-range` and the SOURCE.md table. Run it, then `--check`.
- `SOURCE.md` owns the subset policy, rerun triggers and the committed size/hash. Read it before changing the face.
- Font-tool rules learned here. Keep `post`, because Chromium's OTS rejects a font without it and falls back to Georgia. Keep `gasp`, because it changes antialiasing. Keep GPOS `kern`, because the wordmark pairs are kerned. Pin `head.modified`, or the output hash drifts per run. Keep name records 0, 1, 2, 4, 6 and 14. Check the OFL for a Reserved Font Name before renaming; this upstream has none.
- A split or extra glyph range earns its place only when a page renders those characters. Measure the cost and state the fallback change. A dead extended file is a cost, not a win.
- A second bundled face gets its own copy of the generator and checks. The workflow below still applies.

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