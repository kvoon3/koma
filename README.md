# koma

A collage tool built on **pane splitting** — like tmux or Herdr: you start with a
single pane, grow the layout with split right / split down, drag dividers to resize,
and drop photos into panes where they can be panned, zoomed and cropped.

Photos never leave your machine; nothing is uploaded. Supports JPEG / PNG / WebP /
HEIC (the iPhone default, decoded locally in the browser via a libheif WASM build).

The name comes from the Japanese **コマ**: a single frame of film or a single panel
of a comic. The tool starts as one frame and grows into a panel layout — literally
「コマ割り」 (koma-wari, paneling).

## Use it

Open `koma.html` (a self-contained single file, ~3.4MB — ~3MB of it is the inlined
HEIC decoder, bundled in so it works fully offline). It is produced by
`bun build`; `dist/index.html` is the same file.

## Develop

```bash
bun install
bun dev
bun run build
bun run lint
```

Requires [mise](https://mise.jdx.dev) (provides Bun) — `mise.toml` pins `bun = 1`.

---

## Model: pane tree

**Not a row/column grid — a binary tree.**

```
start                press V              focus right half, press S
┌────────┐        ┌───┬────┐          ┌───┬────┐
│        │   →    │   │    │    →     │   │    │
└────────┘        └───┴────┘          │   ├────┤
                                      └───┴────┘
```

```ts
type Node = Leaf | Split
interface Leaf { type: 'leaf', id, photoId, zoom, cx, cy, stickers: Sticker[], label: PaneLabel | null }
interface Split { type: 'split', id, dir: 'row' | 'column', ratio, a: Node, b: Node }
interface Sticker { id, photoId, x, y, s }
interface PaneLabel { text, font, x, y, size } // x/y: pane-normalized center; size: ‰ of short edge
```

`dir: 'row'` splits left/right, `'column'` splits top/bottom.

The key benefit: **each divider belongs to exactly one split node**. Dragging it
only redistributes `ratio` between that node's two subtrees — panes outside and
inside are untouched. A row/column grid can't do this; dragging there moves whole
rows.

## Interaction

| Action | Effect |
|---|---|
| Two buttons at pane top center | Split top/bottom or left/right (appear on hover, always visible on empty panes) |
| **Handle at canvas bottom-right** | **Change the whole canvas aspect ratio** (double-click to follow the first photo again) |
| Drag a divider | Redistribute the ratio between that split's two sides |
| Drag inside a pane | Pan the photo |
| Wheel / pinch | Zoom the photo, anchored at the cursor |
| Double-click inside a pane | Reset that pane's photo |
| Drop a photo onto a pane | Place it directly into that pane |
| "Sticker" button on a pane | Pick an image from the library and pin it onto the photo (e.g. to cover faces); drag to move, corner handle to scale, × to delete |
| "Text" button on a pane | Add a text label (black on white, pinned to the pane): drag to move, corner handle to resize, double-click to edit, hover toolbar to pick a Google font |
| × at pane top right | Close the pane (hidden while only one pane exists) |

| Key | Action |
|---|---|
| `V` | Split focused pane left/right |
| `S` | Split focused pane top/bottom |
| `X` | Close focused pane |
| `Tab` | Cycle focused pane |
| `R` | Reset focused pane's photo |
| `L` | Library drawer |
| `,` | Settings drawer (theme / gap / radius / canvas fill / export size) |
| `⌘E` | Export collage |
| `C` | Export crop report |
| `?` | Help |
| `Esc` | Close overlay / clear focus / exit sticker mode |

**Canvas aspect ratio** initially follows the first photo added. Drag the
bottom-right handle to change it (double-click to follow again).

### Why the resize handle wraps around the pointer

The canvas is **centered** in the workspace, so every size change of Δ gives Δ/2
back to each side — mapping raw drag deltas to size makes the handle lag behind
the pointer by half.

Instead the handle maps "pointer offset from canvas center = half width/height":

```
hx = clientX - centerX
hy = clientY - centerY
ratio = hx / hy
fill  = 2*hx / fitCanvas(ratio, avail).W
```

Away from the bounds, `fill` makes the displayed size exactly `2*(hx,hy)`, so the
handle sits precisely under the pointer (measured offset: 0,0). At the bounds,
`fill` clamps to ≤1, the canvas stops shrinking, and the handle feels "stuck".

`canvasFill` only affects how large the canvas appears in the preview — **it does
not affect export** (export resolution comes from the long-edge setting in
Settings; the ratio comes from `ratio`).

## Settings drawer (`,` or "Settings" in the status bar)

| Setting | Effect |
|---|---|
| Theme | Auto (follow system) / Dark / Light |
| Photo gap | Space between panes, 0–12% |
| Photo radius | Corner radius of each pane, 0–20% |
| Canvas fill | Black / white / custom color / **transparent** |
| Export size | Long-edge pixels (presets + custom), with a live W×H readout |
| Font mirror | Use fonts.loli.net as fallback CDN when fonts.googleapis.com is unreachable |

**Gap and radius are per-mille of the canvas short edge, not pixels.** Once set,
exporting at 1080 or 6000 looks identical — preview and export share the same
`u = min(W,H)/1000` scale.

With "transparent", the canvas shows a checkerboard and export switches to PNG
(JPEG cannot store alpha).

---

## Three implementation notes

### 1. Preview and export share one math (`src/lib/panes.ts`)

`layoutTree()`, `placement()` and the sticker `stickerRect()` are called by both
the renderer and the exporter, with different W/H. Decorative sizes (gap, radius)
scale by `canvas short edge / 1000`, so export scales them proportionally.
Result: **preview and export match exactly, no export drift** — including
stickers, which are anchored in photo-normalized coordinates and follow the
photo's pan/zoom, landing in the same spot at export time. Text labels follow the
same rule — the exporter draws them through the shared `labelRect()` and sizes
them in ‰ of the short edge, so a label sits identically at any export
resolution, including on panes with no photo at all.

Key invariant:

```
drawn width w = iw × max(cw/iw, ch/ih) × zoom = max(cw, ch·iw/ih) × zoom
```

independent of the image's own pixel size — a 1800px preview image and the 6000px
original produce the identical drawn rectangle.

### 2. Three-tier image assets (`src/lib/imageStore.ts`)

A decoded 6000×4000 JPEG is **96MB** of memory; using it directly for a few
previews will crush the browser tab:

| Tier | Size | Created when |
|---|---|---|
| thumb | ~220px | Thumbnail scrolls into view (IntersectionObserver) |
| preview | ~1800px | Photo enters a pane; original released right after |
| file | original File | Decoded only at export, `close()`d right after drawing |

Measured: three resident 24MP photos keep heap usage around 10MB.

### 3. `probeJpeg()` / `probeHeic()` — real dimensions without decoding

Parses the JPEG SOF marker (plus EXIF orientation to swap width/height when
needed), reading only the first 256KB of the file; for HEIC it parses `ispe`
(dimensions) and `irot` (rotation — where iPhone portrait shots store it) from
the meta box. Orders of magnitude faster than decoding a 24MP frame, so the
canvas ratio is decided **the instant a photo is added** and `trueW/trueH` are
available immediately, before the preview exists. Neither probe decodes pixels
or touches WASM.

The HEIC decoder ([heic-to](https://github.com/hoppergee/heic-to), libheif
compiled to WASM) is dynamically imported: it only loads the first time an
actual HEIC is encountered, costing pure JPEG/PNG users nothing.

---

## Layout

```
src/
  lib/panes.ts       pane tree: split/remove/layout/placement, shared by preview and export
  lib/imageStore.ts  three-tier image assets + JPEG/HEIC header probing
  lib/heic.ts        HEIC: meta box probing + WASM decoding (heic-to)
  lib/exporter.ts    high-res rendering + crop report export
  lib/fonts.ts       curated Google Fonts catalog + runtime loading (with mirror fallback) and text measurement
  components/
    Stage.tsx        canvas: computes layout, renders panes and dividers
    Pane.tsx         one pane: photo, pan/zoom, split buttons, drop target
    StatusBar.tsx    31px persistent status bar
    LibraryDrawer.tsx / Library.tsx
    SettingsDrawer.tsx
    HelpOverlay.tsx
  store.ts           zustand: tree + photos + visual params + export params
```

Fixed defaults (top of `store.ts`; the Settings drawer edits the same-named
state fields): `GAP = 10`, `RADIUS = 0`, `BG = '#0f1013'`, `MIN_PANE_PX = 56`.

## Debug

The build exposes debug handles on `window.__collage`:

```js
__collage.store().root
__collage.panes.leafList(__collage.store().root)
__collage.imageStore.getPreview(__collage.store().photos[0])
__collage.exporter.buildCropReport({})
```
