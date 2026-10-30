# Measuring and verifying a font subset

Commands and a harness pattern for the font work. Run them from the worktree root.

## Font inventory

```bash
find . -path ./node_modules -prune -o -type f \
  \( -iname '*.woff' -o -iname '*.woff2' -o -iname '*.ttf' -o -iname '*.otf' \) -print
rg -n '@font-face|font-display|unicode-range|preload|font-family|fontFamily' src routes index.html
```

Dump one face with fontTools. `uv run --with fonttools --with brotli python /tmp/font-info.py path/to/font.woff2` gives a throwaway environment for the snippet below.

```python
from fontTools.ttLib import TTFont
f = TTFont(path)
print('bytes', len(open(path, 'rb').read()))
print('glyphs', f.getGlyphOrder())
print('cmap', [hex(c) for c in sorted(f.getBestCmap())])
print('axes', [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in f['fvar'].axes] if 'fvar' in f else 'none')
print('weight', f['OS/2'].usWeightClass)
for tag in ('GSUB', 'GPOS', 'GDEF', 'BASE', 'gasp', 'fpgm', 'prep', 'cvt ', 'vhea', 'vmtx', 'post'):
    print(tag, tag in f)
if 'GPOS' in f:
    print('features', [r.FeatureTag for r in f['GPOS'].table.FeatureList.FeatureRecord])
print('names', [(n.nameID, n.toUnicode()) for n in f['name'].names])
```

Hinting lives in the glyph instructions and the `fpgm`, `prep` and `cvt ` tables. A font can also carry `gasp`, which changes smoothing and is not hinting.

## Page bytes

```bash
bun run build
rg -o 'data:font/woff2;base64,[A-Za-z0-9+/=]+' dist/assets/*.css
find dist -iname '*.woff2' -print
for f in dist/assets/*.css; do
  printf '%s raw=%s gzip=%s brotli=%s\n' "$f" \
    "$(wc -c < "$f" | tr -d ' ')" \
    "$(gzip -9 -c "$f" | wc -c | tr -d ' ')" \
    "$(brotli -q 11 -c "$f" | wc -c | tr -d ' ')"
done
```

An inlined font costs 4 base64 characters per 3 font bytes, so a 272-byte font drop removes 364 characters from the CSS. The compressed CSS delta is the transfer delta. If `find` prints a woff2, the font is a separate asset and its request belongs in the page cost.

Runtime Google Fonts are separate. Measure them with Playwright response events when a label uses one. A CJK label can fetch several slices, and the 3-second mirror fallback can fetch a second CSS.

## Pixel harness

Build both trees from the same source content.

```bash
cp -R dist /tmp/font-work/dist-before
# swap the font, then
bun run build
cp -R dist /tmp/font-work/dist-after
python3 -m http.server 4181 --bind 127.0.0.1 --directory /tmp/font-work/dist-before &
python3 -m http.server 4182 --bind 127.0.0.1 --directory /tmp/font-work/dist-after &
```

Playwright-core lives in the worktree's `node_modules`. Use a cached Chromium from `~/Library/Caches/ms-playwright`. The repo already has the dist server and MIME map in `scripts/verify-resize-handle.mjs`, and the cached-Chromium lookup and canvas seed in `scripts/check-filter-popup.mjs` and `scripts/jev-e2e.mjs`. Reuse them instead of adding a seventh copy.

```js
import { chromium } from 'playwright-core'

// findChromium() is copied from scripts/check-filter-popup.mjs.
const browser = await chromium.launch({ headless: true, executablePath: findChromium() })
for (const sc of scenarios) {
  const ctx = await browser.newContext({
    viewport: { width: sc.w, height: sc.h },
    deviceScaleFactor: sc.dpr ?? 1,
    colorScheme: sc.theme,
    reducedMotion: 'reduce',
  })
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|fonts\.loli\.net/, r => r.abort())
  const page = await ctx.newPage()
  await page.clock.install({ time: new Date('2026-10-30T10:00:00') })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__collage?.store)
  await page.evaluate(() => {
    const s = window.__collage.store()
    s.addLabel(0.5, 0.5, { text: 'café \u2014 “curly” … naïve 中文', font: '', theme: 'dark', size: 34, rot: 0 })
    location.hash = `#/w/${s.activeId}`
  })
  await page.waitForSelector('[data-label-id]')
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r })))
  })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/${sc.name}.png`, animations: 'disabled' })
  await page.locator('span.font-brand').screenshot({ path: `${out}/${sc.name}-wordmark.png`, animations: 'disabled' })
  await ctx.close()
}
await browser.close()
```

Add photos with the fixed canvas seed from `scripts/check-filter-popup.mjs` when a scenario needs them. Keep timestamps and random ids out of anything visible. Capture the baseline twice and diff it against itself before trusting a before/after result.

Compare every PNG. Zero differing pixels is the pass. Run the diff with:

```bash
uv run --with pillow --with numpy python /tmp/font-diff.py
```

```python
from PIL import Image
import numpy as np

a = np.asarray(Image.open(path_a).convert('RGBA')).astype(int)
b = np.asarray(Image.open(path_b).convert('RGBA')).astype(int)
assert a.shape == b.shape
d = (a != b).any(axis=2)
print('diff pixels', int(d.sum()), 'max delta', int(abs(a - b).max()))
```

## Scenario list

- Overview, light and dark, at 1280×900.
- Editor, light and dark, with photos and labels, one label selected.
- Editor at deviceScaleFactor 2.
- Help overlay, for mono `kbd` text.
- Crop report, for the monospace ImageMagick command.
- Settings panel.
- Music card dialog, which has its own lyric font setting.
- Library page.
- Legacy launcher, with a fixed clock.
- Mobile editor at 375×812, where the wordmark is hidden.

Add pages with accented characters, curly quotes, dashes, ellipsis and CJK. The app has no italic content; do not fabricate an italic case.

## Current baselines

Measured 2026-10-30. Re-measure before relying on them.

| Item | Value |
| --- | ---: |
| Wordmark font | 1,112 B |
| Base64 payload | 1,484 chars |
| Shared CSS raw | 89,909 B |
| Shared CSS gzip -9 | 17,405 B |
| Shared CSS brotli 11 | 14,104 B |
| Font requests and preloads per route | 0 and 0 |

The font is inlined because it is under Vite's 4 KB `assetsInlineLimit`. Mobile hides the wordmark and leaves the face unloaded, but the base64 bytes still ride the shared CSS.

The CSS delta is larger than the font delta because the build used to pick up utilities from skill prose in `.claude` and `.agents`. `src/index.css` now excludes both, so compare font bytes from the base64 payload, not from the whole CSS.

One sampled CJK label (`Noto Serif SC`, `中文 日本語`) fetched 145,396 B of woff2 and 230,407 B of CSS, including the mirror fallback after the 3-second timeout. That path is content-dependent and was not changed.