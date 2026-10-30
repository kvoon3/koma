#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools>=4.68.0", "brotli>=1.1.0"]
# ///
"""
Regenerate the top bar's Zen Old Mincho wordmark subset.

The site's only bundled webfont is the four-glyph "koma" face in
`src/assets/fonts`. It is a Google Fonts subset, then trimmed here: the dead
space glyph, the empty GSUB, the unused BASE / GDEF / vertical tables, and the
name records the wordmark does not need. Kerning and `gasp` stay because they
change pixels.

Run by hand, then commit the printed font and its SHA-256:

    uv run scripts/subset-wordmark-font.py
    uv run scripts/subset-wordmark-font.py --check   # verify, write nothing

Rerun when any of these changes:

- the wordmark text (`TopBar.tsx`),
- the `unicode-range` in `src/index.css`,
- the upstream Google Fonts revision.

`--check` regenerates the font from Google and compares it with the committed
file. A mismatch means an upstream revision moved or the hand-run output was
not committed; it also fails when `src/index.css` or `SOURCE.md` disagree with
the file. The build never calls this script.
"""

import argparse
import hashlib
import io
import re
import sys
import urllib.request
from pathlib import Path

import brotli
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import WOFF2FlavorData

WORDMARK = 'koma'
UPSTREAM_REVISION = 'v14'
ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = ROOT / 'src/assets/fonts/zen-old-mincho-700-koma.woff2'
SOURCE_MD = ROOT / 'src/assets/fonts/SOURCE.md'
INDEX_CSS = ROOT / 'src/index.css'
CSS_URL = 'https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@700&text=koma'
BROWSER_UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
)
# `post` stays: Chromium's OTS rejects a font without it and falls back to
# Georgia (measured). `gasp` stays because it changes antialiasing, and GPOS
# `kern` stays because the wordmark pairs are kerned.
DROP_TABLES = ('BASE', 'GDEF', 'GSUB', 'vhea', 'vmtx')
NAME_IDS = (0, 1, 2, 4, 6, 14)
WOFF2_BROTLI_QUALITY = 10


def codepoints() -> list[int]:
    return sorted({ord(ch) for ch in WORDMARK})


def unicode_range() -> str:
    return ', '.join(f'U+{cp:02X}' for cp in codepoints())


def normalize_range(value: str) -> str:
    return re.sub(r'\s+', '', value).lower()


def fetch_upstream() -> bytes:
    req = urllib.request.Request(CSS_URL, headers={'User-Agent': BROWSER_UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        css = response.read().decode('utf-8')
    range_match = re.search(r'unicode-range:\s*([^;}]+)', css)
    if not range_match or normalize_range(range_match.group(1)) != normalize_range(unicode_range()):
        raise SystemExit(f'the endpoint no longer serves {unicode_range()}:\n{css}')
    match = re.search(r'src:\s*url\((https://[^)]+)\)\s*format\([\'"]woff2[\'"]\)', css)
    if not match:
        raise SystemExit(f'no woff2 URL in the Google Fonts response:\n{css}')
    url = match.group(1)
    revision = re.search(r'[?&]v=([^&)]+)', url)
    if not revision or revision.group(1) != UPSTREAM_REVISION:
        found = revision.group(1) if revision else 'unknown'
        raise SystemExit(
            f'upstream revision moved from {UPSTREAM_REVISION} to {found}; '
            'review the rendering, then update UPSTREAM_REVISION and SOURCE.md'
        )
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': BROWSER_UA}), timeout=30) as response:
        return response.read()


def subset_font(upstream: bytes) -> bytes:
    font = TTFont(io.BytesIO(upstream))
    # TTFont defaults to stamping head.modified with the current time on save,
    # which makes the output hash differ per run. Keep the upstream timestamp.
    font.recalcTimestamp = False
    options = subset.Options()
    options.flavor = None
    options.hinting = False
    options.recalc_timestamp = False
    options.layout_features = ['kern']
    options.name_IDs = list(NAME_IDS)
    options.name_legacy = False
    options.drop_tables = list(options.drop_tables) + [tag for tag in DROP_TABLES if tag not in options.drop_tables]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=WORDMARK)
    subsetter.subset(font)

    sfnt = io.BytesIO()
    font.save(sfnt, reorderTables=False)

    packed = TTFont(io.BytesIO(sfnt.getvalue()), recalcBBoxes=False, recalcTimestamp=False)
    packed.flavor = 'woff2'
    packed.flavorData = WOFF2FlavorData(transformedTables={'glyf', 'loca'})

    # fontTools calls brotli with its default quality (11). On a stream this
    # small, quality 10 is smaller; the bytes are still lossless woff2.
    real_compress = brotli.compress

    def compress_q10(data, mode=brotli.MODE_GENERIC, quality=11, lgwin=22, lgblock=0):
        return real_compress(data, mode=mode, quality=WOFF2_BROTLI_QUALITY, lgwin=lgwin, lgblock=lgblock)

    brotli.compress = compress_q10
    try:
        out = io.BytesIO()
        packed.save(out, reorderTables=False)
    finally:
        brotli.compress = real_compress
    return out.getvalue()


def verify(font_bytes: bytes) -> None:
    font = TTFont(io.BytesIO(font_bytes), lazy=False)
    glyphs = font.getGlyphOrder()
    cmap = font.getBestCmap()
    problems = []
    if glyphs != ['.notdef', 'a', 'k', 'm', 'o']:
        problems.append(f'glyphs are {glyphs}')
    if sorted(cmap) != codepoints():
        problems.append(f'cmap is {[hex(cp) for cp in sorted(cmap)]}')
    forbidden = [tag for tag in DROP_TABLES if tag in font]
    if forbidden:
        problems.append(f'unexpected tables {forbidden}')
    if 'GPOS' not in font or 'post' not in font or 'gasp' not in font:
        problems.append('GPOS, post or gasp went missing')
    else:
        features = [record.FeatureTag for record in font['GPOS'].table.FeatureList.FeatureRecord]
        if 'kern' not in features:
            problems.append(f'GPOS features are {features}')
    names = {record.nameID for record in font['name'].names}
    missing = [name_id for name_id in NAME_IDS if name_id not in names]
    if missing:
        problems.append(f'name records missing: {missing}')
    if font['OS/2'].usWeightClass != 700:
        problems.append(f"weight class is {font['OS/2'].usWeightClass}")
    if problems:
        raise SystemExit('subset self-check failed:\n  ' + '\n  '.join(problems))


def check_docs(font_bytes: bytes) -> list[str]:
    digest = hashlib.sha256(font_bytes).hexdigest()
    size = f'{len(font_bytes):,}'
    expected_range = unicode_range()
    problems = []
    css = INDEX_CSS.read_text()
    css_ranges = re.findall(r'unicode-range:\s*([^;}]+)', css)
    if not css_ranges or expected_range.lower() not in css_ranges[0].lower():
        problems.append(f'index.css unicode-range should be {expected_range}')
    doc = SOURCE_MD.read_text()
    row = re.search(r'\| `zen-old-mincho-700-koma\.woff2` \| ([\d,]+) \| `([0-9a-f]{64})` \|', doc)
    if not row:
        problems.append('SOURCE.md has no font size/hash row')
    elif row.group(1) != size or row.group(2) != digest:
        problems.append(f'SOURCE.md should read {size} and {digest}')
    return problems


def update_docs(font_bytes: bytes) -> None:
    doc = SOURCE_MD.read_text()
    row = r'(\| `zen-old-mincho-700-koma\.woff2` \| )[\d,]+( \| `)[0-9a-f]{64}(` \|)'
    replacement = rf'\g<1>{len(font_bytes):,}\g<2>{hashlib.sha256(font_bytes).hexdigest()}\g<3>'
    updated = re.sub(row, replacement, doc)
    if updated == doc:
        raise SystemExit('SOURCE.md row not found; update the size and hash by hand')
    SOURCE_MD.write_text(updated)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='compare the committed font and docs, write nothing')
    args = parser.parse_args()

    font_bytes = subset_font(fetch_upstream())
    verify(font_bytes)
    digest = hashlib.sha256(font_bytes).hexdigest()
    size = len(font_bytes)

    if args.check:
        if not FONT_PATH.exists():
            raise SystemExit(f'missing {FONT_PATH}')
        committed = FONT_PATH.read_bytes()
        if committed != font_bytes:
            raise SystemExit(
                f'{FONT_PATH.name} is stale: committed {len(committed):,} bytes '
                f'({hashlib.sha256(committed).hexdigest()}), regenerated {size:,} bytes ({digest})'
            )
        doc_problems = check_docs(font_bytes)
        if doc_problems:
            raise SystemExit('\n'.join(doc_problems))
        print(f'up to date: {size:,} bytes, {digest}')
        print(f'unicode-range: {unicode_range()}')
        return 0

    FONT_PATH.write_bytes(font_bytes)
    update_docs(font_bytes)
    print(f'wrote {FONT_PATH.relative_to(ROOT)}: {size:,} bytes')
    print(f'sha256: {digest}')
    print(f'unicode-range: {unicode_range()}')
    return 0


if __name__ == '__main__':
    sys.exit(main())