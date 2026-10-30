# Zen Old Mincho wordmark subset

The top bar's wordmark vendors only the glyphs it needs, in Zen Old Mincho Bold,
instead of loading the family from a CDN. The text lives in `wordmark.json`. The
file is small enough to ship inside the bundle, so the brand paints in the first
frame, offline, with no fallback face to swap out of.

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
| `zen-old-mincho-700-koma.woff2` | 1,112 | `8b12cf37d41533f9d825ebbc86549a4089c6fdbb53f9730808337eea7e523617` |
| `OFL.txt` | 4,399 | `469d214f9842809659c827b7f2adaf40ec0df6efdd5fe18b7127665c32aafaec` |

The face renders only the literal wordmark, so the subset stops there. It does
not add Latin-1 or Latin Extended-A: no `font-brand` text uses them today, and
adding them would replace the Georgia fallback on any future wordmark text.
Kerning (`ko`, `om`) and `gasp` stay because both change pixels. `BASE`, `GDEF`,
the empty `GSUB`, the vertical metrics, the dead space glyph and the unused name
records are dropped.

Rerun after changing `wordmark.json` or after the upstream Google Fonts
revision moves (update `UPSTREAM_REVISION`). The script writes the font, the
`unicode-range` in `src/index.css`, this table and the endpoint and revision
lines above:

```bash
uv run scripts/subset-wordmark-font.py          # writes the font and syncs the docs
uv run scripts/subset-wordmark-font.py --check  # verifies, needs network
```

`--check` regenerates from Google, so it needs network. The PEP 723 block pins
`fonttools` and `brotli`; other versions can produce a different woff2 hash.
The script also runs under Python 3.11+ with those versions installed. The
build never runs it.
