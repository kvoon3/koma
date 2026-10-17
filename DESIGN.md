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
interface Leaf { type: 'leaf', id, photoId, zoom, cx, cy, rot?, flipX?, flipY?, stickers: Sticker[], label: PaneLabel | null } // rot: radians, absent = upright; flips: absent = not mirrored
interface Split { type: 'split', id, dir: 'row' | 'column', ratio, a: Node, b: Node }
interface Sticker { id, photoId, x, y, s, rot } // rot: radians, 0 when absent (old saves)
interface PaneLabel { text, font, theme: 'dark' | 'light', x, y, size, rot } // x/y: pane-normalized center; size: ‰ of short edge; theme: dark = white on black (default); rot: same rule as Sticker
```

`dir: 'row'` splits left/right, `'column'` splits top/bottom.

The key benefit: **each divider belongs to exactly one split node**. Dragging it
only redistributes `ratio` between that node's two subtrees; panes outside and
inside are untouched. A row/column grid can't do this; dragging there moves whole
rows.

## Interaction

| Action | Effect |
|---|---|
| Back button floating at the top left (edit view) | Back to the 3×3 grid |
| Reset button floating at the top right | Reset to blank canvases (confirm first): the active workspace in the editor, all nine workspaces from the grid overview; photos fall back to the library, so only the arrangement is lost |
| Camera chip above the 3×3 grid (grid view) | Snapshot the whole board as one image and open it in the export preview: the nine previews as the grid draws them (cover-fit square cells, panes flush), the grid gap scaled with the board, empty cells left blank. Disabled while every workspace is empty, and while another export is rendering |
| Split chip: faded in at the top center of a pane you hover (focused or not), plus in the page row between back and reset for the focused pane below lg | Split it top/bottom or left/right. Both chips act on the pane they name; from lg up the page-row copy is dropped because the pane's own chip is within reach, and below the sm breakpoint the hover copy is dropped instead, a touch screen having no hover to fade it in, so the page-row chip is what a phone keeps |
| Tools panel above the footer | An overlay, so it never takes layout space, sized to its tools, and it is always on screen: there is no put-away state, the smallest display is the icon-only row. Three displays, in tap order: one row of icons, one row of icon + label (the default), and the wrapped multi-row, which only exists while the tools do not fit one row. The whole sheet is a grab surface, handle or tool button alike, and it snaps to the nearest display with a flick (lists inside it keep their own scroll, and hold still while the sheet itself is being dragged); a tap on the handle walks the same three. Replace / Sticker / Make / Text act on the focused pane, so they only enable while a pane is focused and holds a photo; with nothing focused the sheet carries the canvas ratio instead (square, follow the first photo, flip), the same commands the workspace menu runs. While a text label is selected (below lg) the sheet swaps the row's tools for the label's own (font, text and background color, opacity, icon, invert, delete), drawn as the same tool buttons so the two sets read as one row. Buttons keep their 80px width (54px in the icon row) and the row scrolls sideways when the screen is too narrow to hold them, the end that still hides tools fading out as it goes: nothing fades while the row fits its panel or sits flush against an end |
| **Handle at canvas bottom-right** | **Change the whole canvas aspect ratio** (double-click to follow the first photo again) |
| Drag a divider | Redistribute the ratio between that split's two sides |
| Drag inside a pane | Pan the photo |
| Wheel / pinch | Zoom the photo, anchored at the cursor |
| Double-click inside a pane | Reset that pane's photo |
| Right-click a pane | Context menu, led by Move, then grouped by what each row acts on: the photo (replace / remove, reset zoom, fit, follow its ratio, save the file, play the Live Photo), the pane itself (split either way, duplicate, reset), its decoration (add / clear stickers, the sticker maker, add / edit / remove the text label), the arrangement (swap with the focused pane, copy / paste, focus), then closing it (other panes, empty panes, this pane). Rows carry the keyboard hints where one exists (S, V, D, R, X) |
| Right-click the stage around the canvas | Workspace menu: add photos / a folder, the library, fill the empty panes from the library, canvas ratio (follow the first photo, flip the orientation), export, crop report, reset this workspace, settings |
| "Move" in the pane menu | The photo follows the pointer with no button held; clicking another pane swaps the two panes' contents (an empty pane takes the photo in). Clicking the source pane, empty space, or pressing Esc drops it back |
| Long-press a pane (touch) | Arms a swap: the drag that follows carries the pane's photo onto another pane, and dropping it there swaps the two panes' contents (an empty pane takes the photo in). Moving before the hold fires pans as usual, and releasing without dragging just focuses the pane |
| An empty pane | Is all picker: a centered "Choose a photo" hint (icon over label, neutral gray) marks it, and a click anywhere in the pane opens the picker and drops the photo into it. Dropping a file straight onto the pane works too |
| Drop a photo onto a pane | An empty pane takes it directly; a pane that already holds a photo asks: "Use as photo" or "Use as sticker" (placed at the drop point) |
| Press and hold a Live Photo pane | Play its paired video (LIVE badge); release to stop; export uses the still |
| "Sticker" in the tools panel | Pick an image and pin it onto the focused pane's photo (e.g. to cover faces); click to select; handles stay pinned like labels (drag to move, corner to scale, bottom-left arrow to rotate, bottom-center chip to reset the angle, × to delete) |
| "Make" in the tools panel | Open the sticker maker: type text or pick an image on one shared stage (the empty image stage is the pick target; after a pick it shows the live die-cut preview, and while the local U²-Netᵖ cutout runs it frosts the raw pick with model-load progress or a cutting-out pulse), tune the outline and finish below the stage, then insert the rendered PNG onto that pane as a sticker. The PNG is cropped to the artwork's visible pixels, so the box the pane places, selects, resizes and exports is the sticker itself rather than the source frame and its padding |
| "Rotate" in the tools panel | Turn or mirror the focused pane's photo, on the shared dial (`components/ui/RotationControl.tsx`): a drag is stepless (23.7° is a value, not a lattice point) with the 15° and 90° ticks felt as magnetism: inside ±4° of a soft tick the angle leans toward it, inside ±10° of a hard one it leans harder while still letting a continuing drag through, and release settles onto a hard tick within 2.5° while keeping any other angle decimals and all. Readout to one decimal, 0 button and double-click to reset, keyboard quantized (arrows 15°, Shift 90°, Alt 1°), plus ±90° quarter turns and the two flips. An upright pane keeps the plain img; a turned one rides a layer inside the photo clip, so the pane box, radius, feather and stickers never turn with it. One gesture is one undo step (`rotatePane:<id>`) |
| "Text" in the tools panel | Add a text label to the focused pane (white on black by default, pinned to the pane) and start editing: click it to select (the toolbar stays pinned: pick a Google font and toggle black/white there, and it stays upright however the label is turned), drag to move, corner handle to resize, bottom-left arrow to rotate, bottom-center chip to reset the angle, double-click to edit, click away or Esc to deselect |
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
| `,` | Settings dropdown (appearance / text) |
| `⌘E` | Export collage (renders, then opens the export preview) |
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
│ Top: koma Photo▾ Help▾  [Settings][Export][🌐][🌙] │ ← wordmark, then menus; actions at the top right
├───────────────────────────────────────────────┤
│ [←]                  [⌸⌸]                  [↺] │ ← floating under the top bar: back, split chip, reset
│                 Stage                         │
│   ⌃ [replace] [sticker] [text] (pull-up)      │
├───────────────────────────────────────────────┤
│ Footer:   Ratio 1.50 · Output 2048 × 1365 px  │
│           Made with ⚡Vite & ♡ by Kevin Kwong  │
└───────────────────────────────────────────────┘
```

The old status-bar stats (panes / filled / focus) are gone; the footer shows
the canvas ratio and the output size, the byline (made with Vite and love by
Kevin Kwong) and the GitHub link last. The grid overview draws no stats at all:
there the footer is only the byline and the link, with no count of the filled
workspaces. Below `sm` the stats are what gives way, not the byline: the two
stats already fill a 360px phone, while the byline is short enough to stay
whole, and a credit that shrinks to a bare heart credits no one.
The split chip is a pane's only hover
chrome: hovering a pane, focused or not, fades it in at that pane's top center,
and below lg the focused pane also draws the same chip in the page row between
the back and reset buttons, so a split is never far away. That page-row copy is
the one a phone gets: below the sm breakpoint the hover copy is dropped, since
there is no hover to fade it in, and the page row keeps its chip on every
width. Everything else a pane shows stays focus-only, the × close button at
the top right. The focused pane's tools (sticker / replace photo / text label)
live in a panel that overlays the canvas above the footer, open by default and
moved only by the handle on its top edge; the tools act on the focused pane, so
the panel exists only while a pane is focused and holds a photo: with no focus
at all, or a focused pane that holds no photo, the panel and its handle are
put away (the empty pane itself is the picker instead).
The divider between two panes carries a grip chip at its midpoint, as wide as
the 15px band that responds to the pointer, so the visible thing is the grab
target: idle it wears the floating-chip colors, and hover or drag fills it with
the accent, lighting the 5px line with it (the line stays lit on its own only
at the min-pane clamp, where the pointer outruns the divider). It is a rounded
box in an otherwise square chrome (6px, the tools handle's radius), and **it
only exists while a pane is focused**: pane chrome like the × and the tools
panel, faded in and out over 140ms, while the line keeps answering the pointer
even with no focus, so a divider never hides the fact that you are on it. A
coarse pointer has no hover to learn from, so there the chip is bumped to 38px.
The grips are drawn in a layer **above every line**: the usual 50/50 split puts
a full-height divider's midpoint exactly on the crossing divider's line, which
would otherwise slice the pill in half. That layer is a sibling of the bands
rather than a child, so the hover that lights a grip is tracked in React, not
through `group-hover` (mouse only; a finger reads the drag state instead).
Overlaying keeps the canvas at full size, and one placement serves desktop
and touch. The Photo menu holds add photos / add folder / library; Help
holds shortcuts + crop report. Settings, Export, the language menu and the
theme toggle sit at the top right of the top bar, and the wordmark opens it at
the left: `koma` in Zen Old Mincho, set larger than the chrome type so it reads
as a brand rather than another menu item, and lifted onto the menus' baseline,
which is what makes the two read as one line (a centered line box drops the
mincho's baseline a pixel below the system text's). Its face ships with the
bundle as a four-glyph subset (`assets/fonts/`, 1.4 KB, OFL), so it paints in
the first frame, offline, with no CDN face to swap in behind it, and stays live
text: the same letters as an inline SVG path are 2.1 KB raw (1.0 KB gzipped) and
as a PNG 1.1 KB per ink colour, and either one trades a font edit for an asset
that has to be regenerated by hand. Below `sm` the
bar is down to the menus and four icon buttons, and the wordmark stands aside.
The back-to-grid button (edit view only) and the reset button float just under
the top bar's left / right corners, over the canvas: reset restores blank
canvases (the active workspace in the editor, all nine from the grid overview),
with the photos falling back to the library.

The Photo and Help menus are a menubar: clicking one and then hovering the
other hands the panel over without a second click. The incoming panel slides
across from the trigger it left (160ms, the outgoing one is dropped at once)
and lands left-aligned under its own trigger, with no cursor tracking. The
settings panel is not a member of that menubar (it is a popover of form
controls under its own button, so it never slides), but it takes part in the
same hand-over: the pointer reaching the Settings button while a menu is open
hands the panel over, and reaching a menu trigger hands it back, so the bar
reads as one row of dropdowns. A category menu lays a modal backdrop over the
rest of the bar while it is open, which would swallow the pointer before it
reached the panel's trigger; `TopBar` therefore watches the window's pointer
and hit-tests the triggers marked `data-bar-trigger` through that backdrop, so
the hand-over runs in both directions.

The 3×3 overview draws every workspace as a square mini canvas: a filled cell
cover-fits its collage (photos, stickers and labels, all placed through the
same `stickerRect()`/label math as the editor) into the cell, an empty one wears
the same near-canvas fill as an empty pane, its content a collage-layout glyph
over “New collage” in the neutral gray, with no button of its own (the whole
cell is the click target). `Grid gap` (Appearance tab) spaces the nine cells.
A camera chip floats above the grid as part of the same centered group (the
only chrome the overview has, and the layout reserves room for it while sizing
the cells). It renders the whole board as **one image** (`renderGridSnapshot`)
and opens it in the export preview: the same cover-fit cells at export scale,
the grid gap scaled with the board, empty cells left blank.

## Grid groups (dual 9-grid: arrangement 1 vs 2)

A board is a group of nine, and the overview holds up to four of them
(`MAX_GRIDS`), so two arrangements can be built and compared before committing
to one. A **group bar** above the grid names the boards and switches which one
the board chrome works on: a click opens a group, a double-click renames it
(inline, Enter or blur commits), the open group's × deletes it behind a confirm,
and undo brings the board back with its cells. `+` adds a group (1, 2, 3, 4) and
opens it. The **compare chip** renders two of them, neighbour selects picking
which: two full 3×3 grids of the same cell previews, captioned by group name,
side by side where there is width for it and stacked one above the other below
Tailwind's `sm` (a phone), where two three-column boards would leave ~45px
cells. A stacked pair is sized to fit the stage above the dock, both boards in
view with no scrolling. A cell still opens the editor for that cell in its own
group (which opens that group first). Comparison is a mode of the overview, not a
route, so the hash URL and the back button keep meaning what they meant, and it
is read-only otherwise: no drag, no + cell, no delete strip, no keyboard walk.
Exports, Shuffle/Clear and the + cell act on the **open** group, the board the
editor would open.

The store keeps the open group's cells in `workspaces`, so every pane and board
action, and every reader of "the board", still works on the board in view, and
keeps the other groups' boards in `parkedBoards` (by group id); opening a group
swaps the two. Adding, deleting and renaming a group are board mutations and
ride the undo stack (`lib/history`), exactly like an added workspace; switching
is navigation and pushes nothing, like `patch({ activeId })`. The session saves
one entry per group (`grids`: id, name, cells, its last active cell) beside the
open board's `workspaces`, so a session written before groups loads as group 1
with every cell intact, and a build from before groups still reads the board it
saved.

## Export preview (`components/ExportDialog.tsx`)

Rendering is the slow half and happens first (the top bar's Export chip keeps
its spinner and the progress toasts run). The finished run then lands in a
dialog rather than straight in the Downloads folder, because the browsers that
matter most here are the ones that block or bury a programmatic download:
WeChat's WebView on a phone, where saving an exported blob either fails or
vanishes, and iOS Safari, where it drops into Files instead of the photo
library.

```
┌─────────────────────────────────────────────┐
│ Export · 3                                × │
├─────────────────────────────────────────────┤
│ [1][2][3]                     ← run strip   │  one thumb per item, in order
├─────────────────────────────────────────────┤
│           ▦ (image on the checker)          │  the still, full size
├─────────────────────────────────────────────┤
│ Space 1 · 2048 × 1365 · JPEG · 1.2 MB       │
│ Long-press the preview to save it …         │  coarse pointer (or WeChat) only
├─────────────────────────────────────────────┤
│        [Copy image] [Download all] [Download]│
└─────────────────────────────────────────────┘
```

- **Nothing is saved unasked**: the dialog is the delivery step, so the user
  sees exactly what is about to be written, at what size and in what format.
- The still is the one image in the app meant to leave through the browser's
  own menus. It sits on the transparency checkerboard on purpose, and
  `.export-shot` (index.css) restores `-webkit-touch-callout` and
  `user-select`, which the app switches off globally so a long-press cannot
  loupe over the canvas: press-and-hold then raises iOS's "Save to Photos" /
  "Copy" sheet, Android's "Download image", and the desktop's right-click
  "Save image as…". The explicit buttons sit right below it.
- **Copy image** writes PNG through `copyImageToClipboard()` (exporter.ts):
  JPEG stills are re-encoded, because the clipboard implementations only
  reliably take `image/png`. A PNG still also keeps a transparent gap fill
  transparent. The `ClipboardItem` is built and `write()` called before the
  encode resolves, which is the only shape Safari keeps its user gesture for.
  The button only exists when `canCopyImage()` says the browser has the API
  (needs HTTPS and `ClipboardItem`).
- **One run per non-empty workspace** in the grid view: they line up in a strip
  above the preview, each thumb captioned by workspace position, size, format
  and file size, with Download image acting on the selection and Download all
  on the run (staggered, because browsers throttle a burst of downloads from
  one gesture).
- **A Live Photo** adds its recorded video as the item right after its still,
  with a LIVE badge, a `<video controls>` preview and its own download; the
  file name still pairs with the still by basename.
- Escape (or the backdrop, or the close chip) dismisses it without touching the
  board: the global shortcut handler yields while the dialog is open
  (`exportItems` in `RootLayout`) and to any key a surface has already claimed
  (`defaultPrevented`), so Escape closes the dialog and does not back out of
  the editor behind it.
- The run owns its preview object URLs (`showRun` / `dropRun` in router.tsx),
  not the dialog instance, so a remount can never blank a preview that is
  still on screen; they are released once the close transition has finished
  painting (`onOpenChangeComplete`), below the close animation's paint.

## Settings panel (`,` or the top-right Settings button)

A dropdown hung off the Settings button itself: right-aligned to it, 4px under
it, wearing the chrome of the menus beside it (panel fill, `line-strong`
hairline, the same scale-out-of-the-trigger motion). It was a bottom drawer, a
screen away from the button that opened it; trigger and panel now share a
corner, so the switch and the surface it opens are one gesture.

Two tabs: `Appearance` (photo gap, gap fill, photo radius, pane border, blend
width / strength, grid gap) and `Text` (font mirror). Photo gap sits next to
gap fill, since they are two halves of the same seam; grid gap is last because
it spaces the 3×3 overview, not the collage.
The strip is set in the panel's heading type, the active tab lit
and underlined, so it reads as the panel's group labels rather than a second
chrome layer; the arrow keys move through it and swap the panel, `Tab` walks in
and out. Only one group is on screen at a time, which is why the panel is
narrower than the old two-column one.

| Tab | Setting | Effect |
|---|---|---|
| Appearance | Photo gap | Space between panes, 0–12% |
| Appearance | Gap fill | Black / white / custom color / **transparent** |
| Appearance | Photo radius | Corner radius of each pane, 0–20% |
| Appearance | Pane border | Draw a hairline around each pane |
| Appearance | Blend width / strength | How far pane seams fade into the shared blurred backdrop |
| Appearance | Grid gap | Space between the nine overview cells, 0–40 px (default 10) |
| Text | Font mirror | Use fonts.loli.net as fallback CDN when fonts.googleapis.com is unreachable |

The language lives in the top bar's globe menu, next to the theme toggle:
English / 简体中文, one row each. The panel's header carries the title and a
`Reset` button that puts every visual knob back to its default (gap, grid gap,
radius, gap fill, blend, pane border, font mirror) and toasts. It closes the way
the other dropdowns do: the trigger again, a click outside, or `Esc`, which no
longer backs out of the editor, base-ui having claimed the key for the open
popover.

The export-size setting was removed: the long edge is fixed at 2048 px; the
footer shows the resulting resolution. The 3×3 snapshot board has the same long
edge, so each of its nine cells gets about a third of it (the gap between cells
scales from the on-screen `GRID_CELL_MAX` reference, keeping the overview's
proportions at any resolution).

Every row is one template (label, control, value). From `sm` up the labels sit
on a shared x, so the sliders line up; below `sm` the value moves onto the label
line and the control takes the full width beneath it, which gives a phone a
~320px slider instead of the ~200px the 84px and 46px columns would leave it.
Each panel is one grid of rows and scrolls on its own between the fixed strip
and the popup's max height (`min(70dvh, 520px)`), so a tab never grows the panel
past its cap and the panel still covers as little of the canvas it edits as it
can. Its width is the field row plus its gutters (350px); below `sm` it takes
the viewport's width less the collision padding, so the shift that keeps it on
screen leaves the same margin on either side. Off toggles and swatches draw
their outline with `line-strong`, because `line` equals the panel's own color in
the dark theme and would leave the control a featureless patch of background.

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
chrome colors. The theme toggle swaps `.dark` inside a view transition
(`fadeTheme` in `src/theme.ts` + the `[data-theme-fade]` rules in `index.css`),
so light ⇄ dark crossfades in 250ms instead of cutting; the OS-driven change
stays instant. A committed pane swap runs inside a view transition the same way
(`runSwapTransition` in `src/components/Pane.tsx`): it names the photo's
clipping wrapper on both panes so the two crops glide across. The named element
has to be the clip (`[data-photo-clip]`, pane-sized, `overflow: hidden`), never
the `img`: the API snapshots an element at its own box, so naming the img
snapshots the whole image and the morph spills past the pane over its
neighbours. Shared UI primitives live in `src/components/ui/`; `field.tsx`
holds the one labelled-control row (label / control / value), the range slider,
the select and the color input, so the settings drawer and the sticker maker
cannot drift apart.

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
resolution, including on panes with no photo at all. Rotation rides the same
rule: both boxes turn about their center (`rotate()` in the preview,
`ctx.rotate()` in the exporter), the angle is stored in radians and wrapped to
(-π, π], and a rotated sticker's resize handle anchors on the rotated opposite
corner, so it still scales along the diagonal the user sees. A pane's photo is
framed the same way: `paneTransform()` (lib/panes) turns it about the pane
center, flips it and grows it by `rotationCoverScale()` so a turn never leaves
empty corners (√2 at 45° on a square), and both sides read that one result, the
preview as `rotate() scale()` on a layer inside the clip and the exporter as
`ctx.rotate`/`ctx.scale` inside the pane clip. The seam feather stays in pane
space on both: the preview masks the clip wrapper, the exporter feathers a
pane-sized scratch after turning.

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

HEIC decoding is the expensive path (a 48MP frame moves ~190MB of ImageData
out of the WASM worker), so it is kept on a leash: the thumb and preview jobs
**share one refcounted full-res decode** per photo (a thumb is shrunk from the
cached preview when one exists), WASM decodes run one at a time through a
two-priority queue (interactive previews and export jump ahead of queued
library thumbs; equal priorities stay FIFO and a running decode is never
preempted), and encodes go through async `toBlob` + object URLs instead of
synchronous `toDataURL`. Export acquires each unique photo's full source
**once per run** (keyed by photo id, joining any in-flight preview decode) and
releases every source only after the last draw. Safari/Webkit browsers
additionally get a native `createImageBitmap` fast path (hardware HEIC decode,
no WASM at all); one failed attempt permanently falls back to libheif.

### 3. `probeJpeg()` / `probeHeic()`: real dimensions without decoding

Parses the JPEG SOF marker (plus EXIF orientation to swap width/height when
needed), reading only the first 256KB of the file; for HEIC it parses `ispe`
(dimensions) and `irot` (rotation, where iPhone portrait shots store it) from
the meta box. Orders of magnitude faster than decoding a 24MP frame, so the
canvas ratio is decided **the instant a photo is added** and `trueW/trueH` are
available immediately, before the preview exists. Neither probe decodes pixels
or touches WASM.

The HEIC decoder ([heic-to](https://github.com/hoppergee/heic-to), libheif
compiled to WASM) is dynamically imported and warmed the moment a dropped set
contains a HEIC, so its parse overlaps probing and rendering: it only loads
when an actual HEIC is encountered, costing pure JPEG/PNG users nothing.

## Layout

```
src/
  router.tsx        code-based routes: / = 3×3 grid, /w/$wsId = editor; hash history (single-file build must work via file://)
  main.tsx          boot: load session → render → debounced autosave + pagehide flush
  lib/panes.ts       pane tree: split/remove/layout/placement, shared by preview and export
  lib/imageStore.ts  three-tier image assets + JPEG/HEIC header probing
  lib/heic.ts        HEIC: meta box probing + WASM decoding (heic-to)
  lib/exporter.ts    high-res rendering (collage + 3×3 board snapshot), file download / clipboard copy, crop report export
  lib/sessionStore.ts   IndexedDB session autosave (workspaces + photos with real File objects)
  lib/workspaceFile.ts  whole-board save/open: .koma.json with photos as data URLs
  lib/fonts.ts       curated Google Fonts catalog + runtime loading (with mirror fallback) and text measurement
  lib/browser.ts     which WebView the page was opened in (WeChat's UA) + the best-effort escape from it
  components/
    Stage.tsx        canvas: computes layout, renders panes, dividers and the tools panel
    Pane.tsx         one pane: photo, pan/zoom, split buttons, drop target
    TopBar.tsx       category menus (workspace / photo / help) + hidden file inputs
    FloatActions.tsx floating back / split / reset buttons under the top bar
    LibraryDrawer.tsx / Library.tsx
    SettingsPanel.tsx
    HelpOverlay.tsx
    ExportDialog.tsx    the preview every export lands in: download / copy / long-press
    ConfirmDialog.tsx   generic confirm (clear library, reset workspace, open workspace file)
    WeChatGuard.tsx     the WeChat browser prompt and its menu guide
  store.ts           zustand: tree + photos + visual params + export params
```

Fixed defaults (top of `store.ts`; the Settings panel edits the same-named
state fields): `GAP = 0`, `GRID_GAP = 10`, `RADIUS = 0`, `BG = '#000000'`
(black gap fill), `MIN_PANE_PX = 56`. Visual settings (gap / radius / bg) persist to
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

## WeChat's built-in browser (`components/WeChatGuard.tsx`)

WeChat identifies its WebView with `MicroMessenger/<version>` in the UA on every
platform, which is what `lib/browser.ts` reads, and it takes away exactly what a
photo editor needs: an export lands in WeChat's own viewer instead of the album,
and its picker re-encodes the photos it hands over. The guard asks once per tab
session on boot: stay here, or leave for the system browser. Staying is
remembered in `sessionStorage` (`collage:wechatStayed`), so a reload does not
re-ask and a new session does.

Leaving has no API. iOS refuses every custom scheme and Android's XWeb kernel
swallows `intent://` in most builds, so asking the system for a VIEW intent is
a best effort the guard makes on Android and ignores elsewhere; the real path
is a picture of WeChat's menu. The ⋯ chip at the top right stands in for the
button in WeChat's own navigation bar, which lives above the page and cannot be
drawn by the page itself, and the arrow under it points there. The step copy
follows the platform (`Open in Safari` on iOS, `Open in Browser` on Android and
the desktop client), a `Copy link` fallback appears where the clipboard API
does and copies the whole hash URL so the same view opens on the other side,
and the small print states what changes: photos imported here live in this
browser's storage, so the system browser starts with an empty library. The card
is bottom-anchored like the drawers rather than centered: on a phone that is
where the thumb is, and it keeps the marker at the top and the answer at the
bottom of the screen.

## Build & deploy

```bash
bun run build         # tsc + vite build (regular chunked bundle)
bun run build:single  # tsc + vite build --mode single → koma.html
bun run deploy        # build + wrangler deploy (Cloudflare, koma.kvoon.me)
```

The default build is a regular chunked bundle; wrangler deploys `dist/` to
koma.kvoon.me. `bun run build:single` instead runs the same config in
`--mode single`, which switches on `vite-plugin-singlefile` to produce
`koma.html`, one self-contained file (it inlines the HEIC decoder and
all assets) that works fully offline, opened directly via file://, which
is also why the router uses hash history.

## Debug

The build exposes debug handles on `window.__collage`:

```js
__collage.store().root
__collage.panes.leafList(__collage.store().root)
__collage.imageStore.getPreview(__collage.store().photos[0])
__collage.exporter.buildCropReport({})
```
