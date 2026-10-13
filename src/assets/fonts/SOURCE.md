# Zen Old Mincho wordmark subset

The top bar's wordmark vendors four glyphs (`k`, `o`, `m`, `a`) of Zen Old Mincho
Bold instead of loading the family from a CDN: the file is small enough to ship
inside the bundle, so the brand paints in the first frame, offline, with no
fallback face to swap out of.

The upstream font is licensed under the SIL Open Font License 1.1 (`OFL.txt`),
and the subset is redistributed under the same license, unmodified apart from
dropping every glyph the wordmark does not use.

- Upstream project: https://github.com/googlefonts/zen-oldmincho
- Designer: Yoshimichi Ohira
- Subset endpoint: `https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@700&text=koma`
- Google Fonts revision: `v14`

Bundled files:

| File | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| `zen-old-mincho-700-koma.woff2` | 1,400 | `0b8fd3b0f4d66794c840b36482731dcc592bb2fbfbeef6bae2581938586e633d` |
| `OFL.txt` | 4,399 | `469d214f9842809659c827b7f2adaf40ec0df6efdd5fe18b7127665c32aafaec` |

To re-subset (say the wordmark text changes): request the endpoint above with a
browser user agent, download the `fonts.gstatic.com/l/font?kit=…` URL it names,
and keep the `unicode-range` line that came with it in the `@font-face` in
`src/index.css`, so a glyph outside the subset still falls back cleanly.
