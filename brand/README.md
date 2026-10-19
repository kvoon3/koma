# koma logo kit · B / three panes

The approved direction: **three filled panes, two gutters, asymmetric 54/58 split**, paired with the
existing Zen Old Mincho wordmark. Light and dark are the same geometry in inverted ink/paper.

## What’s here

```
symbol/
  koma-symbol-light.svg          ink #171717, transparent
  koma-symbol-dark.svg           paper #FAFAFA, transparent
  koma-symbol-black.svg          #000000, for one-colour print
  koma-symbol-white.svg          #FFFFFF, reversed
  koma-symbol-currentColor.svg   single path, fill=currentColor (React/inline SVG)
  koma-symbol-currentColor-tight.svg  same, cropped to the 208 mark box
  koma-symbol-small-currentColor-tight.svg  small cut, 224 crop (top bar/UI ≤24px)
  koma-symbol-small-*.svg        16–24 px cut (16 margin, 28 gutters)

wordmark/
  koma-wordmark-light/dark/black/white.svg   outlined Zen Old Mincho “koma”

lockup/
  koma-lockup-horizontal-light/dark/black/white.svg
  koma-lockup-stacked-light/dark/black/white.svg

app-icon/
  koma-app-icon-light.svg        #F5F5F5 rounded tile + ink mark
  koma-app-icon-dark.svg         #171717 rounded tile + paper mark
  koma-app-icon-light-square.svg full-bleed (iOS / maskable)
  koma-app-icon-dark-square.svg  full-bleed

favicon/
  favicon.svg                    theme-aware tile (light ⇄ dark via prefers-color-scheme)
  favicon-light.svg              fixed light tile
  favicon-dark.svg               fixed dark tile
  favicon.ico                    16/32/48 fallback (dark tile)

web/
  favicon.svg, favicon.ico, site.webmanifest, head-snippet.html
  icons/icon-192.png, icon-512.png, maskable-512.png
  icons/light-192.png, light-512.png
  apple-touch-icon.png

png/
  app-icon/…                    1024, 512, 256, 192, 180, 167, 152, 120, 64, 32, 16
  symbol/, lockup/, wordmark/   transparent preview rasters
  on-color/                     light-on-paper and dark-on-ink previews
  favicon/                      16/32/48 light + dark

brand-sheet.html / brand-sheet.png   the one-page presentation
guidelines.md                          usage rules, clear space, colours, misuse
```

## Pick the file

| You need | Use |
|---|---|
| Logo on a light page / in light UI | `symbol/koma-symbol-light.svg`, `lockup/…-light.svg` |
| Logo on a dark page / in dark UI | `symbol/koma-symbol-dark.svg`, `lockup/…-dark.svg` |
| One-colour print / engraving | `-black` or `-white` (or `currentColor` for inline) |
| 16–24 px symbol | `symbol/koma-symbol-small-light.svg` / `-dark` |
| Favicon | `favicon/favicon.svg` (theme-aware) + `favicon.ico` fallback |
| App icon / PWA | `app-icon/…` or `png/app-icon/…`; square for maskable |
| Desktop (MyGo) icon | `png/app-icon/dark-1024.png` |
| Wordmark only | `wordmark/…` |

## Web install

1. Copy the contents of `web/` to your site root (or Vite `public/`).
2. Add the four lines from `web/head-snippet.html` to `<head>`.
3. Ensure the paths resolve: `./favicon.svg`, `./favicon.ico`, `./apple-touch-icon.png`,
   `./site.webmanifest`, `./icons/…`.
4. If you build a **single-file** HTML, inline `favicon.svg` as a data URI (`data:image/svg+xml,…`),
   because the separate files will not travel with it.

The favicon SVG carries a `prefers-color-scheme` style block (a deliberate exception to the
no-style-block rule) so one file serves both themes. The `.ico` is the dark tile for browsers that
ignore SVG favicons.

## koma integration

- Runtime files live in `public/`: `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`,
  `site.webmanifest`, `icons/…`.
- `index.html` carries the icon links; the SVG favicon is inlined as a data URI so the single-file
  `koma.html` build also gets a favicon.
- `resources/icon.png` is the dark 1024 app icon for MyGo.

## Credits and limits

- Wordmark: **Zen Old Mincho Bold** by Yoshimichi Ohira, SIL OFL 1.1; subset supplied by the app.
  The logo files outline the wordmark; the font itself is not redistributed here.
- The mark is original to koma. No trademark clearance has been performed; get a search before
  launch.
- The light/dark app icons use the app’s neutral palette. The optional shu accent is documented in
  `guidelines.md` but not used by default.
