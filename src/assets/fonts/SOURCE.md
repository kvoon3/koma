# Zen Old Mincho wordmark subset

The top bar's wordmark vendors four glyphs (`k`, `o`, `m`, `a`) of Zen Old Mincho
Bold instead of loading the family from a CDN: the file is small enough to ship
inside the bundle, so the brand paints in the first frame, offline, with no
fallback face to swap out of.

The upstream font is licensed under the SIL Open Font License 1.1 (`OFL.txt`),
and the subset is redistributed under the same license. The upstream copyright
statement names no Reserved Font Name, so the subset keeps the family name and
the copyright and license records.

- Upstream project: https://github.com/googlefonts/zen-oldmincho
- Designer: Yoshimichi Ohira
- Subset endpoint: `https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@700&text=koma`
- Google Fonts revision: `v14`

Bundled files:

| File | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| `zen-old-mincho-700-koma.woff2` | 1,128 | `f6be8576ad05fa8b2648c2954ee6b05e1e50fa721aa8f35cd56e9cbbcbf22c5d` |
| `OFL.txt` | 4,399 | `469d214f9842809659c827b7f2adaf40ec0df6efdd5fe18b7127665c32aafaec` |

The face renders only the literal wordmark, so the subset stops at those four
characters. It does not add Latin-1 or Latin Extended-A: no `font-brand` text
uses them today, and adding them would replace the Georgia fallback on any
future non-`koma` wordmark. Kerning (`ko`, `om`) and `gasp` stay because both
change pixels. `BASE`, `GDEF`, the empty `GSUB`, the vertical metrics, the dead
space glyph and the unused name records are dropped.

Re-subset after the wordmark text, the `unicode-range` in `src/index.css`, or
the upstream Google Fonts revision changes:

```bash
uv run scripts/subset-wordmark-font.py          # writes the font and updates the table above
uv run scripts/subset-wordmark-font.py --check  # verifies the font, CSS and table
```

The script fetches the endpoint above with a browser user agent, downloads the
`fonts.gstatic.com/l/font?kit=…` file, trims it as described, and prints the
`unicode-range` to keep in the `@font-face`. It also runs under any Python
3.11+ with `fonttools` and `brotli` installed. The build never runs it.
