#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.68.0", "brotli==1.2.1"]
# ///
"""
Regenerate the top bar's Zen Old Mincho wordmark subset.

The wordmark text lives in `src/assets/fonts/wordmark.json`. The subset policy,
rerun triggers and the committed size/hash live in `SOURCE.md` beside the font.

Run by hand, then commit the printed font and its SHA-256:

    uv run scripts/subset-wordmark-font.py
    uv run scripts/subset-wordmark-font.py --check   # verify, needs network

The build never calls this script.
"""

import argparse
import hashlib
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import WOFF2FlavorData

ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = ROOT / 'src/assets/fonts/zen-old-mincho-700-koma.woff2'
WORDMARK_JSON = ROOT / 'src/assets/fonts/wordmark.json'
SOURCE_MD = ROOT / 'src/assets/fonts/SOURCE.md'
INDEX_CSS = ROOT / 'src/index.css'
FAMILY = 'Zen Old Mincho'
WEIGHT = 700
UPSTREAM_REVISION = 'v14'
BROWSER_UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
)
# `post` stays: Chromium's OTS rejects a font without it and falls back to
# Georgia (measured). `gasp` stays because it changes antialiasing, and GPOS
# `kern` stays because the wordmark pairs are kerned.
DROP_TABLES = ('BASE', 'GDEF', 'GSUB', 'vhea', 'vmtx')
NAME_IDS = (0, 1, 2, 4, 6, 14)
FACE_RE = re.compile(r'@font-face\s*\{(?P<body>[^}]*)\}', re.S)
SOURCE_ROW = re.compile(rf'\| `{re.escape(FONT_PATH.name)}` \| ([\d,]+) \| `([0-9a-f]{{64}})` \|')


def load_wordmark() -> str:
    try:
        text = json.loads(WORDMARK_JSON.read_text())['text']
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise SystemExit(f'cannot read the wordmark text from {WORDMARK_JSON}: {error}') from error
    if not isinstance(text, str) or not text:
        raise SystemExit(f'{WORDMARK_JSON} must hold a non-empty "text" string')
    return text


WORDMARK = load_wordmark()
CSS_URL = f'https://fonts.googleapis.com/css2?family={FAMILY.replace(" ", "+")}:wght@{WEIGHT}&text={WORDMARK}'


def codepoints() -> list[int]:
    return sorted({ord(ch) for ch in WORDMARK})


def unicode_range() -> str:
    return ', '.join(f'U+{cp:02x}' for cp in codepoints())


def normalize_range(value: str) -> str:
    return re.sub(r'\s+', '', value).lower()


def face_match(css: str) -> re.Match:
    for match in FACE_RE.finditer(css):
        if re.search(rf"font-family:\s*['\"]{re.escape(FAMILY)}['\"]", match.group('body')):
            return match
    raise SystemExit(f'no @font-face for {FAMILY} in {INDEX_CSS.relative_to(ROOT)}')


def css_unicode_range(css: str) -> str:
    match = re.search(r'unicode-range:\s*([^;}]+)', face_match(css).group('body'))
    if not match:
        raise SystemExit(f'the {FAMILY} @font-face has no unicode-range')
    return match.group(1)


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
            'review the rendering, then update UPSTREAM_REVISION'
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

    # Save as sfnt and reopen before packing. The reopen normalises the table
    # layout, and packing the subsetter's font directly is larger.
    sfnt = io.BytesIO()
    font.save(sfnt, reorderTables=False)
    packed = TTFont(io.BytesIO(sfnt.getvalue()), recalcBBoxes=False, recalcTimestamp=False)
    packed.flavor = 'woff2'
    packed.flavorData = WOFF2FlavorData(transformedTables={'glyf', 'loca'})
    out = io.BytesIO()
    packed.save(out, reorderTables=False)
    return out.getvalue()


def verify(font_bytes: bytes) -> None:
    font = TTFont(io.BytesIO(font_bytes), lazy=False)
    glyphs = font.getGlyphOrder()
    cmap = font.getBestCmap()
    problems = []
    if not glyphs or glyphs[0] != '.notdef' or len(glyphs) != len(codepoints()) + 1:
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
    if font['OS/2'].usWeightClass != WEIGHT:
        problems.append(f"weight class is {font['OS/2'].usWeightClass}")
    if problems:
        raise SystemExit('subset self-check failed:\n  ' + '\n  '.join(problems))


def check_docs(size: int, digest: str) -> list[str]:
    expected_range = unicode_range()
    problems = []
    css = INDEX_CSS.read_text()
    if normalize_range(css_unicode_range(css)) != normalize_range(expected_range):
        problems.append(f'index.css unicode-range should be {expected_range}')
    body = face_match(css).group('body')
    if not re.search(rf'font-weight:\s*{WEIGHT}\b', body):
        problems.append(f'index.css should declare font-weight {WEIGHT}')
    if not re.search(r'font-display:\s*block\b', body):
        problems.append('index.css should keep font-display: block')
    doc = SOURCE_MD.read_text()
    row = SOURCE_ROW.search(doc)
    if not row:
        problems.append(f'SOURCE.md has no size/hash row for {FONT_PATH.name}')
    elif row.group(1) != f'{size:,}' or row.group(2) != digest:
        problems.append(f'SOURCE.md should read {size:,} and {digest}')
    if CSS_URL not in doc:
        problems.append(f'SOURCE.md should name the endpoint {CSS_URL}')
    if f'Google Fonts revision: `{UPSTREAM_REVISION}`' not in doc:
        problems.append(f'SOURCE.md should name revision {UPSTREAM_REVISION}')
    return problems


def update_docs(size: int, digest: str) -> None:
    doc = SOURCE_MD.read_text()
    row = f'| `{FONT_PATH.name}` | {size:,} | `{digest}` |'
    updated = SOURCE_ROW.sub(lambda _: row, doc)
    if updated == doc:
        raise SystemExit(f'SOURCE.md has no size/hash row for {FONT_PATH.name}')
    updated = re.sub(r'(- Subset endpoint: `)[^`]+(`)', lambda m: m.group(1) + CSS_URL + m.group(2), updated)
    updated = re.sub(r'(- Google Fonts revision: `)[^`]+(`)', lambda m: m.group(1) + UPSTREAM_REVISION + m.group(2), updated)
    SOURCE_MD.write_text(updated)

    css = INDEX_CSS.read_text()
    match = face_match(css)
    if normalize_range(css_unicode_range(css)) == normalize_range(unicode_range()):
        return
    body = re.sub(r'(unicode-range:\s*)[^;}]+', lambda m: m.group(1) + unicode_range(), match.group('body'), count=1)
    block = match.group(0).replace(match.group('body'), body, 1)
    INDEX_CSS.write_text(css[:match.start()] + block + css[match.end():])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='compare the committed font and docs, write nothing')
    args = parser.parse_args()

    font_bytes = subset_font(fetch_upstream())
    verify(font_bytes)
    size = len(font_bytes)
    digest = hashlib.sha256(font_bytes).hexdigest()

    if args.check:
        if not FONT_PATH.exists():
            raise SystemExit(f'missing {FONT_PATH}')
        committed = FONT_PATH.read_bytes()
        if committed != font_bytes:
            raise SystemExit(
                f'{FONT_PATH.name} is stale: committed {len(committed):,} bytes '
                f'({hashlib.sha256(committed).hexdigest()}), regenerated {size:,} bytes ({digest})'
            )
        doc_problems = check_docs(size, digest)
        if doc_problems:
            raise SystemExit('\n'.join(doc_problems))
        print(f'up to date: {size:,} bytes, {digest}')
        print(f'unicode-range: {unicode_range()}')
        return 0

    FONT_PATH.write_bytes(font_bytes)
    update_docs(size, digest)
    print(f'wrote {FONT_PATH.relative_to(ROOT)}: {size:,} bytes')
    print(f'sha256: {digest}')
    print(f'unicode-range: {unicode_range()}')
    return 0


if __name__ == '__main__':
    sys.exit(main())