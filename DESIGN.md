# koma: design notes

## Model: pane tree

**Not a row/column grid but a binary tree.**

```
start                press V              focus right half (L), press S
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
interface PaneLabel { text, font, theme: 'dark' | 'light', x, y, size } // x/y: pane-normalized center; size: ‰ of short edge; theme: dark = white on black (default)
```

`dir: 'row'` splits left/right, `'column'` splits top/bottom.

The key benefit: **each divider belongs to exactly one split node**. Dragging it
only redistributes `ratio` between that node's two subtrees; panes outside and
inside are untouched. A row/column grid can't do this; dragging there moves whole
rows.

## Interaction

| Action | Effect |
|---|---|
| Two buttons at the top center of a focused pane | Split it top/bottom or left/right (a pane shows its buttons only while focused, never on hover) |
| Tools row above the footer | Sticker / Replace / Text, acting on the focused pane; an empty pane offers only "Choose a photo". The row's space is reserved either way, so focusing never resizes the canvas |
| **Handle at canvas bottom-right** | **Change the whole canvas aspect ratio** (double-click to follow the first photo again) |
| Drag a divider | Redistribute the ratio between that split's two sides |
| Drag inside a pane | Pan the photo |
| Wheel / pinch | Zoom the photo, anchored at the cursor |
| Double-click inside a pane | Reset that pane's photo |
| Right-click a pane | Context menu: split, swap with the focused pane (unfocused panes), close |
| Long-press a pane (touch) | Same context menu as right-click; tap-to-focus happens on release, so "swap with focused pane" targets the previously focused pane |
| An empty pane | Shows a dimmed image icon, not a button: focus it and use "Choose a photo" in the tools row above the footer, or drop a file straight onto the pane |
| Drop a photo onto a pane | An empty pane takes it directly; a pane that already holds a photo asks: "Use as photo" or "Use as sticker" (placed at the drop point) |
| Press and hold a Live Photo pane | Play its paired video (LIVE badge); release to stop; export uses the still |
| Tools row · "Sticker" | Pick an image and pin it onto the focused pane's photo (e.g. to cover faces); click to select; handles stay pinned like labels (drag to move, corner to scale, × to delete) |
| Tools row · "Text" | Add a text label to the focused pane (white on black by default, pinned to the pane) and start editing: click it to select (the toolbar stays pinned: pick a Google font and toggle black/white there), drag to move, corner handle to resize, double-click to edit, click away or Esc to deselect |
| × at pane top right | Close the pane (hidden while only one pane exists; shown while the pane is focused) |

| Key | Action |
|---|---|
| `H J K L` | Focus the pane left / down / up / right (vim-style) |
| `V` | Split focused pane left/right (vsplit) |
| `S` | Split focused pane top/bottom (split) |
| `X` | Close focused pane |
| `D` | Remove the photo from the focused pane |
| `Tab` | Cycle focused pane |
| `R` | Reset focused pane's photo |
| `I` | Library drawer |
| `,` | Settings drawer (gap / radius / canvas fill / export size) |
| `⌘E` | Export collage |
| `C` | Export crop report |
| `?` | Help |
| `Esc` | Close overlay / deselect label / clear focus |

**Canvas aspect ratio** initially follows the first photo added. Drag the
bottom-right handle to change it (double-click to follow again).

### Why the resize handle wraps around the pointer

The canvas is **centered** in the workspace, so every size change of Δ gives Δ/2
back to each side; mapping raw drag deltas to size makes the handle lag behind
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

`canvasFill` only affects how large the canvas appears in the preview; **it does
not affect export** (export resolution comes from the long-edge setting in
Settings; the ratio comes from `ratio`).

## Chrome layout

```
┌───────────────────────────────────────────────┐
│ Top: Photo▾ Help▾        [Settings][Export][🌙] │ ← actions at the top right
├───────────────────────────────────────────────┤
│                 Stage                         │
│     [sticker] [replace] [text]  (focused)     │
├───────────────────────────────────────────────┤
│ Footer:   Ratio 1.50 · Output 2048 × 1365 px  │
└───────────────────────────────────────────────┘
```

The old status-bar stats (panes / filled / focus) are gone; the footer shows
the canvas ratio and the output size. A pane shows its buttons only while it
is focused, never on hover: the two split buttons at the top center and the
× close button at the top right. The focused pane's tools (sticker / replace
photo / text label) sit in one row above the footer, so a phone-sized pane
needs no second chrome placement. The Photo menu holds add photos / add
folder / library; Help holds shortcuts + crop report. Settings, Export and
the theme toggle sit at the top right of the top bar.

The Photo and Help menus are a menubar: clicking one and then hovering the
other hands the panel over without a second click. The incoming panel slides
across from the trigger it left (160ms, the outgoing one is dropped at once)
and lands left-aligned under its own trigger, with no cursor tracking.

## Settings drawer (`,` or the top-right Settings button)

| Setting | Effect |
|---|---|
| Photo gap | Space between panes, 0–12% |
| Photo radius | Corner radius of each pane, 0–20% |
| Canvas fill | Black / white / custom color / **transparent** |
| Font mirror | Use fonts.loli.net as fallback CDN when fonts.googleapis.com is unreachable |

The export-size setting was removed: the long edge is fixed at 2048 px; the
footer shows the resulting resolution. Every row is one template (label,
control, value) so every control shares an x; wide screens pair the four
sections into two columns, which halves the drawer's height and how much of the
canvas it covers.

**Gap and radius are per-mille of the canvas short edge, not pixels.** Once set,
exporting at 1080 or 6000 looks identical; preview and export share the same
`u = min(W,H)/1000` scale.

With "transparent", the canvas shows a checkerboard and export switches to PNG
(JPEG cannot store alpha).

## Styling

Tailwind v4 (via `@tailwindcss/vite`) with a token-only color system. Raw palette
values live on `:root` / `html.dark` in `src/index.css`; `@theme inline` maps them
to semantic tokens (`bg-panel`, `text-dim`, `border-line`, `bg-accent`, …) so
`.dark` re-themes every utility at runtime; never reach for `dark:` variants for
chrome colors. Shared UI primitives live in `src/components/ui/`.

`@shadcn/lint` (see `eslint.config.mjs`) enforces this: `shadcn/no-raw-colors`,
`shadcn/no-unknown-classes`, and `shadcn/no-restyle` run on `bun run lint`.
Exceptions: the multi-layer stage/swatch checkerboards stay as component classes
in `index.css`, and labels/swatches legitimately use literal white/black (export
fidelity and gap-fill picks).

## Three implementation notes

### 1. Preview and export share one math (`src/lib/panes.ts`)

`layoutTree()`, `placement()` and the sticker `stickerRect()` are called by both
the renderer and the exporter, with different W/H. Decorative sizes (gap, radius)
scale by `canvas short edge / 1000`, so export scales them proportionally.
Result: **preview and export match exactly, no export drift** (including
stickers, which are anchored in photo-normalized coordinates and follow the
photo's pan/zoom, landing in the same spot at export time. Text labels follow the
same rule: the exporter draws them through the shared `labelRect()` and sizes
them in ‰ of the short edge, so a label sits identically at any export
resolution, including on panes with no photo at all.

Key invariant:

```
drawn width w = iw × max(cw/iw, ch/ih) × zoom = max(cw, ch·iw/ih) × zoom
```

independent of the image's own pixel size: a 1800px preview image and the 6000px
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

### 3. `probeJpeg()` / `probeHeic()`: real dimensions without decoding

Parses the JPEG SOF marker (plus EXIF orientation to swap width/height when
needed), reading only the first 256KB of the file; for HEIC it parses `ispe`
(dimensions) and `irot` (rotation, where iPhone portrait shots store it) from
the meta box. Orders of magnitude faster than decoding a 24MP frame, so the
canvas ratio is decided **the instant a photo is added** and `trueW/trueH` are
available immediately, before the preview exists. Neither probe decodes pixels
or touches WASM.

The HEIC decoder ([heic-to](https://github.com/hoppergee/heic-to), libheif
compiled to WASM) is dynamically imported: it only loads the first time an
actual HEIC is encountered, costing pure JPEG/PNG users nothing.

## Layout

```
src/
  router.tsx        code-based routes: / = 3×3 grid, /w/$wsId = editor; hash history (single-file build must work via file://)
  main.tsx          boot: load session → render → debounced autosave + pagehide flush
  lib/panes.ts       pane tree: split/remove/layout/placement, shared by preview and export
  lib/imageStore.ts  three-tier image assets + JPEG/HEIC header probing
  lib/heic.ts        HEIC: meta box probing + WASM decoding (heic-to)
  lib/exporter.ts    high-res rendering + crop report export
  lib/sessionStore.ts   IndexedDB session autosave (workspaces + photos with real File objects)
  lib/workspaceFile.ts  whole-board save/open: .koma.json with photos as data URLs
  lib/fonts.ts       curated Google Fonts catalog + runtime loading (with mirror fallback) and text measurement
  components/
    Stage.tsx        canvas: computes layout, renders panes, dividers and the focused pane's tools row
    Pane.tsx         one pane: photo, pan/zoom, split buttons, drop target
    TopBar.tsx       category menus (workspace / photo / help) + hidden file inputs
    LibraryDrawer.tsx / Library.tsx
    SettingsDrawer.tsx
    HelpOverlay.tsx
    ConfirmDialog.tsx   generic confirm (clear library, open workspace file)
  store.ts           zustand: tree + photos + visual params + export params
```

Fixed defaults (top of `store.ts`; the Settings drawer edits the same-named
state fields): `GAP = 0`, `RADIUS = 0`, `BG = '#000000'` (black gap fill),
`MIN_PANE_PX = 56`. Visual settings (gap / radius / bg) persist to
localStorage as `collage:settings` via zustand `persist`; the font mirror
defaults to on and persists as `collage:fontMirror`.

## Routing & persistence

TanStack Router (code-based) with **hash history**: `/` is the 3×3 overview,
`/w/$wsId` the editor; unknown ids redirect to `/`. The view no longer lives
in the store: the route is the view; the route param drives `activeId`.
Grid↔edit navigations pass `viewTransition` so the cell→canvas morph keeps
working (disabled under prefers-reduced-motion via `viewTransitionOption()`).

The whole session (workspace trees, settings, and the photo library with
real `File` objects via IndexedDB structured clone) autosaves to the
`koma-session` database, debounced 800ms with a flush on page hide. Boot
hydrates from it before the first render, so a refresh lands exactly where
you left off; photos whose header probe never finished are re-probed on
hydrate. `clearLibrary` wipes the database too.

**Workspace file** (Workspace menu): the entire board + library export as
`koma-<date>.koma.json` (photos embedded as data URLs, Live Photo MOVs
included, ids preserved), and opening one replaces the current board after a
confirm. Originals inflate ~33% as base64; the upgrade path is an fflate zip
container.

## Build & deploy

```bash
bun run build    # tsc + vite build + cp dist/index.html koma.html
bun run deploy   # build + wrangler deploy (Cloudflare, koma.kvoon.me)
```

`koma.html` is a self-contained single file, ~3.4MB, ~3MB of it is the inlined
HEIC decoder, bundled in so it works fully offline.

## Debug

The build exposes debug handles on `window.__collage`:

```js
__collage.store().root
__collage.panes.leafList(__collage.store().root)
__collage.imageStore.getPreview(__collage.store().photos[0])
__collage.exporter.buildCropReport({})
```
