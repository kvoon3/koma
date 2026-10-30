# koma logo guidelines

**v1.0 · B direction (“three panes”) · light + dark**

koma is a collage tool built on pane splitting. The mark is the editor reduced to its atom: three
filled panes and two gutters, the same split-right / split-down gesture the product starts with.
The wordmark is the app’s existing **Zen Old Mincho** lowercase “koma”, outlined to paths.

---

## 1. The mark

| | |
|---|---|
| Canvas | 256 × 256 |
| Mark box | 208 × 208 (24 margin) |
| Gutters | 24 (11.5% of the mark) |
| Top pane | 208 × 99 (54% of the pane area) |
| Bottom left | 107 × 85 |
| Bottom right | 77 × 85 (58/42 split) |
| Fill | one colour, solid, no strokes |
| Small cut | 16 margin, 28 gutters for ≤ 24 px |

The asymmetry is deliberate: the bottom split is 58/42, not 50/50. Do not “fix” it to centre.

The small cut (`symbol/koma-symbol-small-*.svg`) is a separate drawing for 16–24 px: it enlarges the
mark inside the canvas (16 margin) and widens the gutters (28), so the panes stay separate at
favicon size. Use it below 24 px; never scale the primary mark down to 16 px.

## 2. Light and dark

| Context | File suffix | Mark | Background |
|---|---|---|---|
| Light UI / print | `-light` | Ink `#171717` | Paper `#FAFAFA`, white, or any light neutral |
| Dark UI / print | `-dark` | Paper `#FAFAFA` | Ink `#171717`, `#0A0A0A` |
| One colour / single-colour print | `-black` / `-white` | `#000000` / `#FFFFFF` | Any contrasting ground |

- Keep the ink/paper pair. Do not use a mid-grey for either.
- On photographs, use a solid tile or a scrim; never place the ink mark directly on a busy image.
- The favicon is the mark alone, no tile and no outer margin: the 16 px small cut, edge to edge.
  The app swaps it with the resolved theme (`applyTheme` calls `syncFavicon`); the SVG's
  `prefers-color-scheme` block is the pre-JS/OS fallback, and the `.ico` is the ink fallback for
  browsers without SVG favicons. The app icon keeps its tile; the favicon does not.
- The in-app wordmark follows the app theme (live text); the favicon follows the app theme too.

## 3. Clear space

Clear space = **one gutter** at the mark’s scale: `24 / 208 ≈ 11.5%` of the mark width on all sides.
For the horizontal lockup, measure from the symbol’s left edge and the wordmark’s right edge, and
from the tallest element (the “k” ascender) top and the baseline bottom. Keep the area free of type,
rules, images and other logos.

## 4. Minimum sizes

| Asset | Digital | Print |
|---|---:|---:|
| Symbol, primary | 24 px | 8 mm |
| Symbol, small cut | 16 px | 5 mm |
| Horizontal lockup | 112 px wide | 30 mm wide |
| Stacked lockup | 72 px wide | 20 mm wide |
| App icon | 16 px | 5 mm |

Below the minimum, use the app icon tile or the wordmark alone.

## 5. Lockups

- `lockup/koma-lockup-horizontal-*.svg`: symbol at 520 font units, gap 260 (≈ 0.55 × x-height), symbol
  baseline on the wordmark baseline. Use this as the default brand lockup.
- `lockup/koma-lockup-stacked-*.svg`: symbol above the wordmark, wordmark at 0.62 scale, 140-unit
  vertical gap. Use for square formats (avatars, cards, thumbnails).
- `wordmark/koma-wordmark-*.svg`: the wordmark alone, for contexts where the name is already present
  or the symbol would be too small.
- Do not recompose, re-space, re-scale or swap the elements. The SVGs are the locked artwork; if you
  need a new arrangement, build it from the same files rather than editing the paths.

## 6. App icon and web icons

- Tile radius **56 / 256 (22%)**. Mark at **~66%** of the tile, lifted 2 units above the geometric
  centre (optical centre).
- Light tile `#F5F5F5` + ink mark; dark tile `#171717` + paper mark. The light icon carries a 2-unit
  `#E5E5E5` inner edge so it stays an object on white.
- Square (`-square`) files are full-bleed for platforms that mask the icon (iOS, maskable manifest
  icons, app stores). Do not add your own rounding to those.
- The 16 px PNG is the smallest raster; the SVG is the master.
- The favicon is separate from the app icon: mark only, no tile, 16 px small cut, edge to edge. The
  tile is for the dock/home screen; do not put it in the tab favicon.
- The MyGo desktop icon is `png/app-icon/dark-1024.png` (transparent outside the rounded tile).

## 7. Colour

| Token | HEX | RGB | CMYK (approx.) | Use |
|---|---|---|---|---|
| Ink | `#171717` | 23 23 23 | 0 0 0 91 | Mark, wordmark, dark tile |
| Paper | `#FAFAFA` | 250 250 250 | 0 0 0 2 | Page, light UI, reversed mark |
| Tile light | `#F5F5F5` | 245 245 245 | 0 0 0 4 | Light app icon tile |
| Tile dark | `#0A0A0A` | 10 10 10 | 0 0 0 96 | Dark surfaces (optional; `#171717` also works) |
| Line | `#E5E5E5` | 229 229 229 | 0 0 0 10 | Rules, light icon edge |
| Shu (optional) | `#C8402F` | 200 64 47 | 0 68 76 22 | Secondary accent only: seal, link, one pane in a social asset |

The brand is monochrome; the photos supply the colour. The optional shu accent is **not** used in the
mark, the app chrome, or the app icon by default. If you use it, keep it to one small element and
check contrast on both themes. Print values are starting points; proof before production.

## 8. Typography

- **Wordmark**: Zen Old Mincho Bold (SIL Open Font License 1.1, by Yoshimichi Ohira), subset to
  `k`, `o`, `m`, `a` and shipped in the app. In the logo files the wordmark is **outlined paths**;
  do not retype it or reset it in another face.
- **UI**: the app’s system sans stack. Do not set the UI in the mincho; it is the brand’s voice, not
  the interface’s.
- Do not add a tagline to the logo unless a separate, approved lockup is made.

## 9. Misuse

- Don’t stretch, rotate, skew, outline, or apply shadows, glows or gradients.
- Don’t move, resize, merge, add or remove panes, or change the 54/58 split.
- Don’t add a camera, aperture, lens, photo stack, rounded photo cards, sparkle or location pin.
- Don’t recolour individual panes (except the approved optional accent in social artwork).
- Don’t put the ink mark on a dark or busy background, or the paper mark on a light one.
- Don’t crop the symbol or lockup into the clear space.
- Don’t use the font as a logo substitute, or rebuild the wordmark from a different serif.

## 10. Files and production

- Masters are SVG, fills only, no live text, no rasters, no filters, no masks. The wordmark is
  outlined. The only `<style>` block is the theme-aware favicon (a deliberate exception).
- PNGs are transparent outside the rounded tile; the square icons are opaque full-bleed.
- The app ships the wordmark as live text (small subset, OFL); that is the in-app asset; the kit’s
  wordmark files are for print, decks and contexts without the app’s font pipeline.
- Trademark clearance was not performed. Before public launch, run a trademark search for “koma” in
  your classes and a reverse image search for the mark.

---

Questions or a new application? Keep the geometry, change nothing else.
