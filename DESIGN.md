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
interface Leaf { type: 'leaf', id, photoId, zoom, cx, cy, rot?, flipX?, flipY?, filter?: FilterValue, stickers: Sticker[], label: PaneLabel | null } // rot: radians, absent = upright; flips: absent = not mirrored; filter: absent = no texture. FilterValue = FilterId | { id: FilterId, block?, levels?, angle?, ink?, matrix?, grain? }
interface Split { type: 'split', id, dir: 'row' | 'column', ratio, a: Node, b: Node }
interface Sticker { id, photoId, x, y, s, rot } // rot: radians, 0 when absent (old saves)
interface PaneLabel { text, font, theme: 'dark' | 'light', x, y, size, rot?, align? } // x/y: pane-normalized center; size: ‰ of short edge; theme: dark = white on black (default); rot: same rule as Sticker; align?: 'left' | 'center' | 'right', absent = center
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
| Workspace chip on the board's caption row (grid view), or a pull down on the board | Open the Mission Control-style switcher over the receding board: one card per group (the open one ringed and enlarged, nothing written under it), + copies the open board into a new group, × deletes a group (never the last). Drag the receded board sideways to switch, click a card to pick its group; a pull up on it, Esc or the backdrop leaves. The strip browses only (it scrolls and snaps, it never switches). Adding and deleting are undoable; switching is navigation |
| Camera chip on the board's caption row (grid view) | Snapshot the whole board as one image and open it in the export preview: the nine previews as the grid draws them (cover-fit square cells, panes flush), the grid gap scaled with the board, empty cells left blank. Disabled while every workspace is empty, and while another export is rendering |
| Split chip: faded in at the top center of a pane you hover (focused or not), plus in the page row between back and reset for the focused pane below lg | Split it top/bottom or left/right. Both chips act on the pane they name; from lg up the page-row copy is dropped because the pane's own chip is within reach, and below the sm breakpoint the hover copy is dropped instead, a touch screen having no hover to fade it in, so the page-row chip is what a phone keeps |
| Tools panel above the footer | An overlay, so it never takes layout space, sized to its tools, and it is always on screen: there is no put-away state, the smallest display is the icon-only row. Three displays, in tap order: one row of icons, one row of icon + label (the default), and the wrapped multi-row, which only exists while the tools do not fit one row. The whole sheet is a grab surface, handle or tool button alike, and it snaps to the nearest display with a flick (lists inside it keep their own scroll, and hold still while the sheet itself is being dragged); a tap on the handle walks the same three. Replace / Sticker / Make / Text act on the focused pane, so they only enable while a pane is focused and holds a photo; with nothing focused the sheet carries the canvas ratio instead (square, follow the first photo, flip), the same commands the workspace menu runs. While a text label is selected (below lg) the sheet swaps the row's tools for the label's own (font, text and background color, opacity, icon, invert, delete), drawn as the same tool buttons so the two sets read as one row. Buttons keep their 80px width (54px in the icon row) and the row scrolls sideways when the screen is too narrow to hold them, the end that still hides tools fading out as it goes: nothing fades while the row fits its panel or sits flush against an end |
| **Handle at canvas bottom-right** | **Change the whole canvas aspect ratio** (double-click to follow the first photo again) |
| **Rail on the right edge** | **Resize the whole canvas, width and height together** (double-click to fit it again) |
| Drag a divider | Redistribute the ratio between that split's two sides |
| Drag inside a pane | Pan the photo |
| Wheel / pinch | Zoom the photo, anchored at the cursor |
| Wheel / pinch on the stage around the canvas | Scale the whole canvas view (1.1× a notch, clamped 0.25–2.5): a view, not the board, so no undo step and nothing saved. The percentage chip that appears at the stage's top left fits it again on a click, so does a double-click out there |
| Drag the pane's minimap (photo zoom above ~1.05) | Pan the photo; a tap without a drag recentres it on that point |
| Double-click inside a pane | Reset that pane's photo |
| Right-click a pane | Context menu, led by Move, then grouped by what each row acts on: the photo (replace / remove, reset zoom, fit, follow its ratio, save the file, play the Live Photo), the pane itself (split either way, duplicate, reset), its decoration (add / clear stickers, the sticker maker, add / edit / remove the text label), the arrangement (swap with the focused pane, copy / paste, focus), then closing it (other panes, empty panes, this pane). Rows carry the keyboard hints where one exists (S, V, D, R, X) |
| Right-click the stage around the canvas | Workspace menu: add photos / a folder, the library, fill the empty panes from the library, canvas ratio (follow the first photo, flip the orientation), export, crop report, reset this workspace, settings |
| "Move" in the pane menu | The photo follows the pointer with no button held; clicking another pane swaps the two panes' contents (an empty pane takes the photo in). Clicking the source pane, empty space, or pressing Esc drops it back |
| Long-press a pane (touch) | Arms a swap: the drag that follows carries the pane's photo onto another pane, and dropping it there swaps the two panes' contents (an empty pane takes the photo in). Moving before the hold fires pans as usual, and releasing without dragging just focuses the pane |
| An empty pane | Is all picker: a centered "Choose a photo" hint (icon over label, neutral gray) marks it, and a click anywhere in the pane opens the picker and drops the photo into it. Dropping a file straight onto the pane works too |
| Drop a photo onto a pane | An empty pane takes it directly; a pane that already holds a photo asks: "Use as photo" or "Use as sticker" (placed at the drop point) |
| Press and hold a Live Photo pane | Play its paired video (LIVE badge); release to stop; export uses the still |
| "Sticker" in the tools panel | Pick an image and pin it onto the focused pane's photo (e.g. to cover faces); click to select; handles stay pinned like labels (drag to move, corner to scale, bottom-left arrow to rotate, bottom-center chip to reset the angle, × to delete) |
| "Make" in the tools panel | Open the sticker maker: type text or pick an image on one shared stage (the empty image stage is the pick target; after a pick it shows the live die-cut preview, and while the local U²-Netᵖ cutout runs it frosts the raw pick with model-load progress or a cutting-out pulse), tune the outline and finish below the stage, then insert the rendered PNG onto that pane as a sticker. The PNG is cropped to the artwork's visible pixels, so the box the pane places, selects, resizes and exports is the sticker itself rather than the source frame and its padding. The outline is a round dilation of the alpha (`lib/stickerFX`), so it follows a cutout's silhouette through its notches instead of boxing it, and **Edge** turns it into a stamp: the same border with antialiased notches punched along its outer rim, tooth depth and spacing on their own sliders, both read in **stage pixels** (`lib/sticker.ts` scales them by the silhouette's texture long edge over the size the stage draws it at), so what the slider says is what the stage shows at 1x. **Adjust cutout** opens a mask over the pick (or over the AI cutout): brush and lasso, keep and erase, space-drag or two fingers to pan and the wheel to zoom, with an in-dialog undo of up to 20 strokes; applying it commits source α × mask α back into the stage |
| "Rotate" in the tools panel | Turn or mirror the focused pane's photo, on the shared dial (`components/ui/RotationControl.tsx`): a drag is stepless (23.7° is a value, not a lattice point) with the 15° and 90° ticks felt as magnetism: inside ±4° of a soft tick the angle leans toward it, inside ±10° of a hard one it leans harder while still letting a continuing drag through, and release settles onto a hard tick within 2.5° while keeping any other angle decimals and all. Readout to one decimal, 0 button and double-click to reset, keyboard quantized (arrows 15°, Shift 90°, Alt 1°), plus ±90° quarter turns and the two flips. An upright pane keeps the plain img; a turned one rides a layer inside the photo clip, so the pane box, radius, feather and stickers never turn with it. One gesture is one undo step (`rotatePane:<id>`) |
| "Filter" in the tools panel | Lay a texture on the focused pane's photo: fourteen pixel-level filters (film grain, three duotones, a two-ink print, cyanotype, a paper tone, a coarse bit grain, then the pixel family: mosaic, tessera, diamond screen, halftone, and the two ordered dithers), plus None to clear. A filter is baked into the photo's own pixels, before placement and before the turn, mirror and crop, so the grain pans and rotates with the photo instead of sitting on the pane; the pane's preview and the exporter run the same pass at the same seed, so what the pane shows is what the file gets. The six pixel filters take parameters, and the strip under the grid dials the active pane's own setting: a stage-pixel block / tile / dot pitch / dither cell (8–48 or 1–8, the same units as the render's 1024-long-edge base, multiplied by `max(w,h)/1024` at draw time), the mosaic's posterise levels and optional speckle, the halftone's screen angle and ink mode, the dither's 4×4 or 8×8 Bayer matrix. The whole value is one atomic `filter` field, so undo, copy / paste and the session treat a dialled filter like any other. Swatches are a 1:1 loupe into the pane photo's filtered bitmap (a whole photo squeezed into 72px would average its own grain away), and the active tile is drawn from the live setting, so the dial reads at the granularity it prints. The filter travels with the photo like `rot`: it copies with duplicate / copy+paste / swap and resets when a photo arrives. One tap is one undo step; a parameter drag coalesces into one. |
| "Text" in the tools panel | Add a text label to the focused pane (white on black by default, pinned to the pane) and start editing: click it to select (the toolbar stays pinned: pick a Google font and toggle black/white there, and it stays upright however the label is turned), drag to move, corner handle to resize, bottom-left arrow to rotate, bottom-center chip to reset the angle, double-click to edit, click away or Esc to deselect |
| "Text" in the tools panel | Add a text label to the focused pane (white on black by default, pinned to the pane) and start editing: click it to select (the toolbar stays pinned: pick a Google font, set the line alignment and toggle black/white there, and it stays upright however the label is turned), drag to move, corner handle to resize, bottom-left arrow to rotate, bottom-center chip to reset the angle, double-click to edit, click away or Esc to deselect |
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

**Canvas aspect ratio** initially follows the first photo added: drag the
handle at the canvas's bottom-right corner to reshape it (double-click to follow
the first photo again), or use the dock's ratio tool and the canvas menu. The
right-edge rail scales the collage as a whole instead (below).

### The canvas resize rail, and the corner handle

Two controls size the canvas, and they do different jobs:

- **The corner handle**, the direct one: a chip straddling the canvas's
  bottom-right corner that reshapes it to any aspect. It is board chrome, so it
  rides the canvas and the view zoom, and it is pinned there: it never dodges
  anything. The tools sheet is an overlay with no put-away state and a tall
  canvas runs under it, so the sheet does cover the handle once the canvas is
  big enough to want resizing, and a canvas scaled past the fit takes its corner
  (and the handle) off the stage entirely. Both are accepted: the handle is the
  direct gesture when the corner is in reach, and the rail below is the control
  that always is. The dock's ratio tools and the canvas menu reshape the board
  from anywhere too.
- **The rail**, the always-reachable one: a vertical control on the stage's
  right edge, centred on the strip the floating chrome leaves free: below the
  action cluster (`useFloatingActionsBottom`) and above the tools sheet
  (`useToolsSheetTop`, the minimap's rule). On a short stage that is what keeps
  a 172px scale out of the undo buttons instead of behind them. It scales the
  canvas as a whole instead of reshaping it, so it works at any size, and it
  never moves with the canvas or the view zoom.

The rail is a **graduated scale**, not a bare slider, and it is the same one the
rotate dial draws: `ui/TickScale` (a hairline spine, marks standing across it,
and a bar riding it) drawn through in both, so the two scales cannot drift into
two designs. On the rail the spine runs vertically at the stage's edge, the
marks cross it, and the bar is a 16×3 playhead, thicker than any mark and long
enough to out-read the strongest one. A percentage chip sits beside it while the
pointer or the keyboard is there, and a focus ring is drawn around the bar
rather than on it (a 3px bar is not a ring's worth of shape). The band is 22px
wide (`26px` under a finger) and is the hit target: the bar is what you read, the
strip is what you press.

`lib/canvasRail` decides the numbers, with tests:

- **The ladder** (`railTicks`): tenths of the fit while the marks are at least
  9px apart, then fifths, quarters or halves as the track shortens, so a phone
  never gets a comb and a desktop never gets three lonely ticks. Every half is a
  longer mark, a bound that would crowd its neighbour is dropped (the track's
  own end already reads as a boundary), and the fit (100%) is the longest one
  and never dimmer than a lit mark. On a 340px track that is 15 marks, 25px
  apart.
- **The feel of passing them**: marks within 52px of the bar light up
  (opacity 0.5 → 0.92, the strong marks 0.9 → 1) and grow to 1.45× their
  length, from a hairline to a full mark, so the scale answers the hand rather
  than sitting there. Strong marks hold their length: they are the landmarks.
  The scale is drawn in the `float` tone there, so every mark wears the icon
  grey rather than the accent (an accent hairline is near-black in the light
  theme, the wrong colour over a dark photo) and is drawn twice: a glass
  underlay a pixel wider, then the mark itself. The underlay is what survives a
  near-black photo (a mark alone is only ~1.5:1 there), and a hard underlay stays
  a hairline where a blurred drop shadow went muddy.
- **The trail**: a moving bar drags a wake (`data-rail-trail`): one tail eases
  toward the bar with an exponential lag (`WAKE_TAU`, 120ms), and the gap between
  them is drawn as a single streak, opaque at the bar and gone at the tail: an
  accent gradient core with a 1px glass rim down each side (a fill would read as
  a lit card, and the rim is what survives a dark photo). Its *length is the
  speed*: a steady 700px/s drag trails about 85px behind, a flick several times
  that, and a bar that stops leaves nothing at all (below `WAKE_MIN` px the
  streak is not drawn; a CSS transition would park a duplicate under it
  instead). The streak is written per frame on the element rather than through
  React state, so the wake never re-renders the board, and it is hidden entirely
  under reduced motion. The canvas itself follows the pointer exactly: the trail
  is the chrome's, with no smoothing to feel through.
- **The fit's magnetism**: `canvasFill` 1 is the one stop worth landing on
  exactly. Inside ±4 points the mapping leans toward it (0.7 of the distance
  removed at the stop, nothing at the band's edge, so the map stays monotonic
  and a continuing drag always walks out), and a release inside ±2 points takes
  it exactly. Measured: a drag released at 102% or 98% lands on 100%; at 104.5%
  it keeps 104.5%.
- **The ends give**: past either bound the bar keeps moving up to 14px
  (`rubberBand`, tanh, so it is smooth at 0 and asymptotic at the end), then
  springs back on release. The canvas is already clamped; the give is the bar's,
  which is the difference between "stuck" and "this is the end".

The rail's scale is `canvasFill`, which multiplies both edges, so width and
height change together and the aspect ratio is untouched (the handle is what
changes the ratio). Up is bigger, and the fit mark sits at 0.63 of the bar's
travel, which is what gives a drag upward somewhere to go: `MAX_CANVAS_FILL`
(1.5) enlarges past the fit and lets the stage crop it, `MIN_CANVAS_FILL` (0.15)
shrinks it. The rail writes the size through `setCanvasFill`, never the ratio,
so a board still following its first photo keeps following it; the corner
handle and the ratio tools are the ones that write `canvasRatio`.

A press anywhere on the band grabs the value where it is and drags it
relatively, the way a finger on a camera's zoom scale does: the bar is a 3px
playhead, not a handle to hit, and nothing jumps under the press. The mapping
uses the rail's own `getBoundingClientRect` rather than the stage's measured
centre: the pointer arrives in viewport px, and mixing the two spaces shifted
every press by the stage's offset (measured: a press read the track 31px higher
and jumped the canvas to 83%).

The rail is a real `role="slider"`: arrows walk the ladder one mark (10 points at
the desktop density, where those are the marks drawn; on a short track the drawn
ladder is coarser and a keypress can land between two of them), Shift/PageUp a
page (50 points), Home/End the bounds, and the visible percentage is
`aria-valuetext`. A double-click fits the canvas again (fill 1) and leaves the
ratio alone. Left alone, the rail draws itself in to a stub around the bar (3.2s
idle; 8s on the first visit) with one clip-path on the whole scale, so the marks
it keeps still show the size at a glance and nothing is re-laid-out as it grows.
The pointer coming back over the band draws it out again, and a press is how a
finger does it: the first tap on a stub opens the rail and grabs the value in one
move, with nothing resized until the finger travels. It tucks on touch as well as
on a mouse: a scale that stays out draws a ruler over the photo's edge for the
whole session, which is a heavier lie than a stub resting there always was.

### Why the corner handle wraps around the pointer

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
canvas corner sits precisely under the pointer. The grab records
`canvas corner − pointer` rather than leaning on the pointer alone: measured
from the corner, a press changes nothing (no snap), and the same offset still
carries when the sheet has lifted the handle off the corner. At the bounds
(`MIN_CANVAS_FILL` / `MAX_CANVAS_FILL`) the canvas stops, and the handle feels
"stuck".

`canvasFill` only affects how large the canvas appears in the preview; **it does
not affect export** (export resolution comes from the long-edge setting in
Settings; the ratio comes from `ratio`).

### The canvas view zoom (`lib/canvasView.ts`, `hooks.useCanvasViewZoom`)

The stage and the grid overview are the same beast: a board centred on a
checker stage with air around it. The wheel (and a trackpad pinch, which arrives
as a ctrl+wheel: neither stage tracks pointers of its own) on that air scales
the WHOLE canvas as a view: a CSS `transform: scale()` about the canvas's
centre, 1.1× per notch, one event never moving more than 1.1^1.5, clamped to
0.25–2.5. In the editor the transform rides the canvas box (`Stage.tsx`'s
`stageRef`); in the overview it rides the board column, caption row included.
It is session working view only: not part of a workspace, not in the undo
history, not persisted, and it resets to fit on a route change. The switcher
owns the stage while it is open, so the overview renders the view at fit and
ignores the wheel there (the recede and the pager keep the geometry they were
written against); the scale it had comes back on close.

Composition with the board's own gestures:

- **Hit testing needs no correction.** Clicks, buttons, focus, drag targets are
  mapped by the browser through the transform, so everything that hit-tests
  natively works untouched.
- **Pointer math does.** Every gesture that turns client pixels into canvas
  pixels divides by `viewScaleAt(node)` (the live scale riding the canvas's
  `data-canvas-view` attribute, read from the nearest wrapper: no context, no
  re-render on a wheel notch): the divider drag, a pane's pointer-local maths
  and drop points, board sticker drags. Ratios are
  scale-free and stay as they are: label drags, rotations, the minimap's own
  mapping.
- **dnd-kit does.** Its translate is measured in screen pixels while the cells
  are laid out in canvas pixels, so the sortable's transform is divided back by
  the scale, the drag ghost is drawn at the scaled size, and collisions are
  decided by `pointerWithin` first (pointer and droppable rects are read in the
  same space) with `closestCenter` as the gap fallback. Measured at 0.5: a cell
  dragged onto its neighbour's centre lands in that slot, and a 40px pointer
  drag on a divider moves the divider 40px on screen (80 canvas px).

Trade-off: zooming in grows the canvas over the stage's air, so past ~1.2 there
is no margin left to wheel and the percentage chip (or a double-click out
there, while any margin remains) is the way back to fit.

### Multi-line text labels

A label is a free-placed board object, not an authored text box, so its text
only breaks at explicit newlines: **no auto-wrap**. Auto-wrap would make a
line's break depend on the current font size and the board's pixel size, and
the preview and the exporter would break the same string differently at
different scales. Enter in the label editor inserts a line break (IME
composition owns Enter meanwhile); Esc or clicking away commits. On commit
every line is trimmed and blank lines at either end are dropped, while blank
lines inside the label survive as deliberate paragraph gaps.

`align` (`left` / `center` / `right`, absent = `center`, the pre-alignment look)
aligns each line inside the box, whose width is the widest line. The desktop
floating toolbar and the mobile label dock both carry the same three-button
group; the patch rides `setLabel:<id>`, so one alignment choice is one undo
step. Preview and export share one placement rule: the DOM's shrink-wrapped
block uses CSS `text-align`, and `drawLabel` uses `labelAlignOffset` on canvas
measurements of the same lines. The parity is measured in the browser (a
three-line left-aligned label: per-line x within 1 px of the exported PNG).

### Photo location from EXIF

Importing a JPEG also reads its APP1 Exif header (`lib/exif.ts`, zero
dependencies, bounded and non-throwing): the GPS IFD's DMS rationals plus the
N/S/E/W refs give a WGS-84 fix, `DateTimeOriginal` gives the capture time.
HEIC and PNG carry no EXIF in this path, so they simply have no fix. When the
focused pane's photo has a fix, the tools gain **Location** (below `lg` the
label dock carries it too): a new board label with a pin icon and the district
name, added in one commit (one undo step), positioned at the pane's center like
the Text tool. With no polygon hit it falls back to the plain coordinate pair.

Reverse geocoding is offline. `scripts/build-districts.mjs` downloads the
AreaCity `ok_geo.csv` (MIT, see `THIRD_PARTY_NOTICES.md`) into the OS temp dir
(the 16.5 MB archive is never committed), keeps the province / city / district
rows, converts their GCJ-02 points to WGS-84 once and Douglas-Peucker
simplifies each ring (~500 m for districts, coarser for the province / city
fallback). The result is `src/data/districts.json` (5.4 MB), imported lazily by
`lib/regeo.ts` on the first Location insert: a 0.5° coarse grid pre-filters
candidate polygons, even-odd point-in-polygon picks the deepest hit, and a
lookup takes microseconds once the chunk has loaded. Nothing about a normal
board load touches the file.

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
the top right and the photo minimap below.
A focused pane whose photo overflows it (zoom above ~1.05) carries a
**minimap** in one chip: a thumbnail of the whole photo with the pane's window
drawn on it as an accent-bordered rect over a white hairline, dragged to pan (a
tap without a drag recentres on the point). A +/− pair used to sit beside it
and was only repeating the wheel and pinch zoom the pane already has, so the
chip is the map and nothing else. It is parked at the corner of the photo's
*visible* rect, 20px in from it, never at the pane's corner, so a zoomed-out
photo pulls the chip in with it and a zoomed-in one pins it to the pane's inner
edge, clear of dividers and neighbours. The 20px (not the 8px the corner alone
wants) is what clears the canvas aspect handle, which reaches 14px inside the
canvas corner; the resize rail's hit band (17px) stays outside the canvas at
fit, beyond the 24px margin the stage leaves it, and a canvas scaled past the
fit runs under the band deliberately. It rests at 0.7 so the photo stays the
subject and comes to full weight under the pointer; a finger has no hover to
confirm it exists, so touch rests at 0.9 and the frame steps up to 44×58. The chip behind the thumbnail is
the floating-chip scrim, so busy content never swallows it. The tools sheet
overlays the stage with no put-away state and a tall canvas runs underneath it,
so the chip stops at the sheet's top edge (8px above it) rather than sitting
behind its glass, and follows the sheet as it cycles displays.
The focused pane's tools (sticker / replace photo / text label)
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
and touch. The Photo menu holds add photos / add folder / the library drawer /
the Library page / clear library; Help
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
The board carries a caption row of its own: the workspace and snapshot chips,
centred over the board (groups render nameless, so there is nothing to name on
the left, and the pair would have been shoved off-centre by a name). The two
board chips thus sit on the board they act on instead of floating over it. The
workspace chip opens the
switcher (below); the snapshot chip renders the whole
board as **one image** (`renderGridSnapshot`) and opens it in the export preview:
the same cover-fit cells at export scale, the grid gap scaled with the board,
empty cells left blank.

The stage sizes every board against chrome it must not grow under: the board's
caption row, and the tools dock's sheet
(`DOCK_CHROME_H`, an overlay that covers the stage's floor). A single board is
bounded by width on a wide screen and by that budget on a short one; the budget
is what keeps the third row of cells off the dock instead of under it.

## Grid groups (workspaces, switched Mission Control-style)

A board is a group of nine, and the app keeps up to four of them (`MAX_GRIDS`)
as alternate arrangements of the same shoot. The **Workspace chip** on the
board's caption row opens a Mission Control-style switcher over the overview:
a frosted, full-width strip near the top of the stage (~13% of its height,
`backdrop-blur` over a translucent panel fill) holds one card per group: a
16:10 thumbnail of its board (every cell the grid's own preview at thumbnail
size, empty slots quiet squares), nothing written under it (the cards are
nameless, and the numbers they used to carry said no more than the pictures
did). The open group's card wears the 2px blue selection ring (the `--sel`
token; the app's own accent is monochrome) and stands slightly larger than its
siblings; the strip's air is sized to hold that larger card's ring, because the
card row is an `overflow-x` scroll box (it clips on both axes) and a ring with
no room for its top and bottom edges reads as two vertical rails.
The board behind recedes: it scales to 65%, dims to 60% and blurs
2px, an app-shrinking feel, and its empty cells drop their glyph and caption
there (quiet squares: at 65% and blurred, nine "New collage" hints are
placeholder noise), while the full overview keeps both. Those quiet squares
keep a 2px `--dim` hairline: on a fresh session's all-empty board they are the
only thing drawn, and the hairline has to survive the dim and the blur for the
board to still read as a board.

Entry and exit are navigation, not a route: the flip rides a view transition
(the board column carries the `ws-board` transition name from before the open
snapshot until the close one has painted, so the browser morphs the full board
into the receded one and back; the strip drops in and lifts out as its own
`ws-strip` pair). Entry has a second door beside the chip: a downward pull
anywhere on the board area (a vertical axis lock past a small slop, then 70px,
so a tap, a short drag and a sideways drag all stay put). A card click zooms
back into that workspace (a neighbour first switches the open group,
navigation, no undo step), and the backdrop, a tap on the receded board, Esc or
a pull up on it returns to the overview as it was. The strip is **browsing only**: it
scrolls sideways (scroll-snap on the cards, free scroll, on open the open
group's card is centred) and never switches the group, so the ring always
marks the open one and the board pager is the one way to change it.
The bare `+` at the strip's right edge (a 44px lane on a coarse pointer)
adds a group that **copies the open board** (photos shared through the library,
every pane / sticker / label id fresh, see `cloneNode`) and opens it; the × on
a card's corner deletes that group (never the last one), no confirm. Adding and
deleting ride the undo stack; one undo removes a copied or restored group
again. A group's name stays in the model (and in the session file) for
compatibility, but nothing renders or edits it any more.

**The receded board is the finger path.** Press it and drag sideways and the
board goes with the finger 1:1 (a ~6px slop keeps a click a click, and the
axis is locked once past it: sideways is the pager, upward is the exit); the neighbouring
group's board slides in from the far edge, in the same clip, drawn by the same
cell previews at the same size, so the two boards pass as one plane. Letting go
snaps to the board the release is nearest (past half a page of travel) or is
heading for (a flick over the dock's `FLICK_VELOCITY` always carries one page),
which is `lib/boardPager`'s rules reusing `lib/dockPhysics`: the same fling
threshold, the same snap picker, and the dock's rubber band at 0.3x for the
first and last group, whose edges have no board behind them, so the board leans
and springs back. A release that lands on a neighbour switches the open group
through `switchGrid` (navigation, no undo step, the row above), and the strip's
ring leans onto that card as soon as the drag passes the halfway point (the one
thing the strip and the board still do together). The
settle is 200ms of `--ease-out`; `prefers-reduced-motion` makes it instant,
while the drag itself stays 1:1, because user-driven motion is not decoration.
A drag that is upward instead of sideways is the way out: 70px up and the
switcher closes, the mirror of the pull down that opened it, on the same axis
lock so neither gesture steals the other early. A tap on the board (under the
slop) is the way out, the same exit the backdrop gives: the surface covers the
biggest target on screen and must not swallow it, while a drag too close to the
diagonal to lock an axis decides nothing. Esc or the backdrop put the board
home again mid-gesture.

The store keeps the open group's cells in `workspaces`, so every pane and board
action, and every reader of "the board", still works on the board in view, and
keeps the other groups' boards in `parkedBoards` (by group id); opening a group
swaps the two. Adding and deleting a group (and renaming it, when something
calls `renameGrid`) are board mutations and ride the undo stack
(`lib/history`), exactly like an added workspace; switching
is navigation and pushes nothing, like `patch({ activeId })`. The session saves
one entry per group (`grids`: id, name, cells, its last active cell) beside the
open board's `workspaces`, so a session written before groups loads as group 1
with every cell intact, and a build from before groups still reads the board it
saved.

## Undo / redo: a step tree (`lib/history.ts`)

Undo is a tree of board snapshots, not a pair of stacks. Every board mutation
commits the state it is about to change (`commit(tag)`), which becomes a step
hanging off the cursor; the cursor is the step the board is at.

- **⌘Z** walks to the parent; **⇧⌘Z / Ctrl+Y** walks down into the child the
  cursor last visited (redo returns where you came from, not to the newest
  branch). A jump from the panel rewrites that visited chain, so redo always
  continues the line you were last on.
- **Jumping**: the clock button beside undo / redo opens the step list
  (`components/HistoryPanel.tsx`), root first, each row with its label and how
  long ago it was recorded. The current row wears the chip-on wash and an accent
  bar down its edge; any row is one click back, restored exactly and with no
  step of its own (browsing never grows the tree). A step with more than one
  child carries a badge that opens the steps beside it.
- **Acting from a step that has children replaces them**: the child the cursor
  last visited (the step redo would have walked into) and its whole subtree are
  deleted, and the new action takes its place, with no prompt and no soft-delete
  state. A replaced branch is destroyed, and that is the product's chosen trade
  for one clean main line instead of a bush of near-identical variants; a
  sibling that was never on the active line is left alone. In practice a
  session's tree is therefore one chain: undo, act, and the truncated line is
  gone for good.
- **One gesture is one step**: commits carrying the same streaming tag inside
  600ms (`rotatePane:<id>`, `moveSticker:<id>`, `setCanvasSize`) collapse into
  the step the gesture opened. Only gesture tags coalesce, so two quick clicks
  on Split are two steps.
- **Cap**: 400 steps. Off-path leaves go first, oldest first; a tree that is
  only the cursor's path (every session, per the rule above) drops its root
  instead and re-roots one step down, like the old linear stack. The tree is
  session-only: a reload, a hydrated session or an opened file forgets it.

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

## Library (`#/library`)

Photos and stickers share one page. The header owns the back chip, the title,
the total, one search field, Add photos and New sticker; the row below it
switches between All, Photos and Stickers, each type chip carrying its count.
The selected type lives in the URL (`?type=photo` / `?type=sticker`, absent =
All), so a reload or a back step keeps the tab; `/photos` and `/stickers` stay
as redirects into their tab rather than 404s. Counts come from the same pure
functions the sections list (`photoAssetsOf`, `stickerAssetsOf`), so the chips,
the section headings and the total cannot disagree.

The page has one scroll container. Each half is an embeddable section
(`components/library/PhotoLibrarySection.tsx` / `StickerLibrarySection.tsx`)
with a heading, its count and a grid; neither carries a page header, a back
chip or a scroller of its own. A section draws its tag or folder chips only
when its type is selected: All shows both grids bare. A tag or folder picked
before the switch therefore cannot narrow a grid whose bar is off screen
(`livePick`); a tag click on a card in All switches the page to Photos and
selects that tag, because the click is a request to see that tag.

Search filters both sections by asset name. `components/library/LibraryPage.tsx`
owns the query, both group picks and the maker, and `LibraryHeader.tsx` is the
chrome. The board drawer stays photo-only and keeps its own thumbnail strip.

```
┌──────────────────────────────────────────────────────────┐
│ [←] Library 8          [ Search… ]  [Add photos] [New]    │
│ All 8 · Photos 5 · Stickers 3                            │
├──────────────────────────────────────────────────────────┤
│ Photos 5                                                 │
│ ▣ ✓Used 1  ▣ Unused  ▣ Unused  ▣ Unused  ▣ Unused        │
│ Stickers 3                                               │
│ ▦ ✓Used 1  ▦ Unused  ▦ Unused                            │
└──────────────────────────────────────────────────────────┘
```

### Stickers

A sticker is a library asset of its own, not a PNG that happens to sit in the
photo section. `Photo` carries the marker: `kind: 'sticker'` (absent = photo,
which is what every session saved before this reads as), a one-level `folder`
(absent = Unsorted), and `orphaned` for an asset that was deleted while a placed
copy still draws it. The photo section, the drawer and the menu count list
`photoAssetsOf` (a positive `kind === 'photo'` match, absent = photo), and the
sticker section lists `stickerAssetsOf` (`kind === 'sticker'`); both hide
orphaned records. The folder list is session state beside the photos
(`stickerFolders`), so an empty folder survives a reload; a folder is a name, a
sticker's `folder` its membership, and a rename repoints the stickers in the
same commit.

```
┌──────────────────────────────────────────────────────────┐
│ Stickers 8                                               │
├──────────────────────────────────────────────────────────┤
│ All 8 · Unsorted 3 · Faces 1 · Animals 2 · Places 2      │
│                                     [✎] [🗑] [+ New folder]│
├──────────────────────────────────────────────────────────┤
│ ▦ ✓Used 1   ▦ Unused   ▦ Unused   ▦ Unused   ▦ Unused      │  checkerboard
│ red-dot.png  blue-dot…  gold-dot…  …                       │  thumbs (alpha)
└──────────────────────────────────────────────────────────┘
```

Each card is the sticker on the transparency checkerboard (the same `stage-clear`
read the export preview gives a PNG), its folder, a usage badge, and move /
delete. **Usage is derived, never stored**: every board of every group is
scanned for photo ids (pane photos, pane stickers, board stickers, plus the
collage background), and the count is what the badge shows. Labels contribute
nothing: their icons are catalog ids, not photos.

**Delete removes the asset, keeps the drawing.** Preview and export resolve a
sticker through the photos map, so dropping the record would blank a placed
copy. On delete the session counts every reference it still holds (all groups'
boards, the background, the pane clipboard, and both undo / redo stacks, since
an undo can restore a pane that draws it): with none the record is dropped, and
with any it is kept as an `orphaned` record that no list shows and every draw
still resolves. Orphans are swept at hydration, the one moment the history is
empty, so nothing can want them back. Deleting a folder never deletes
stickers: they fall back to Unsorted.

Folder moves, renames and deletes are **library actions, outside the board
history** (like `clearLibrary`): they push no undo entry, so one ⌘Z after
sorting still undoes the last board change. Deletion is the one destructive
library action, so it confirms, and the confirm says what survives.

**New sticker** in the toolbar opens the editor's sticker maker, with one
difference at the end: its save files the PNG in the picked folder (Unsorted
when the chips are on All) and touches no board, so it pushes no undo entry
either. There is one maker, not two: `StickerMakerDialog` takes a
`StickerTarget` (`lib/stickerAssets`) and only its save branches, on `pane`
(bake, then pin onto the board, the editor's Make tool) or `library` (bake,
then file under the folder, the page's New sticker). The source is either a
file pick (the app's shared picker) or a photo already imported, picked from
the drawer's own thumbnail grid inside the stage slot, so the cutout, the edge
effects and the mask editor are the same code on both roads. The save button
names the target ("Save to Faces"), and every opening starts from an empty
stage so a new sticker never inherits the last one's pick.

Entry is the top bar's Photo menu (both views) and the library header's New
sticker button; the sticker tab is one of the page's type chips.

**Erase and Re-edit: two depths of editing an existing sticker.** A saved
sticker is the *composited* PNG (cutout, border and perforation baked in), so
there are exactly two things the library can offer over it, and the difference
is whether the maker's inputs still exist:

- **Erase** (`components/StickerEraseDialog.tsx`) paints the sticker's *own*
  alpha. It opens the maker's `StickerMaskEditor` over the final PNG: brush
  keep / erase, lasso, wheel zoom and space-or-two-finger pan, and the same
  20-snapshot undo, with the commit being source α × mask α (`lib/stickerMask`).
  Nothing but the record's pixels is needed, so it is offered on **every**
  sticker, including every one made before this existed. Only the dialog shell
  is new code; the editor, its undo stack and its commit are shared with the
  maker's *Adjust cutout*.
- **Re-edit** means *edit again from the start*: the maker reopens on the
  ORIGINAL picture the sticker was started from (`StickerMakerDialog` in its
  `reEdit` mode), re-runs the AI cutout on it, and loads the style the sticker
  was saved with as the starting values of the controls (outline, edge, teeth,
  material) with a **Reset effects** button that puts them back. Nothing is
  inherited from the finished pixels except the style numbers. It needs
  `Photo.recipe`; a legacy asset has none and the card does not draw the button.

**The sticker item stores a pair: the original and the result.** The result is
the record itself (its `Photo.file`, the composited PNG) and needs no field; the
original is `Photo.recipe.original`, written once at save time by
`addStickerAsset`:

```ts
type StickerOriginal
  = | { type: 'text', text: string, color: string, fontId: string } // no image exists: the spec is the original
    | { type: 'image', src: string, name: string, photoId?: string } // src: the un-cut photo, data URL ≤ 1600px

interface StickerRecipe {
  original: StickerOriginal
  style: StickerBakeStyle // outline width/color, material, baseName, perforation, displayLongEdge
}
```

The image original is the **picture the user picked**, before any cutout, border
or material, re-encoded to its own data URL: a subject may come from a file that
was never imported, and a photo id would describe neither that nor a file the
library later lost, while an object URL dies with the dialog. `photoId` rides
along as provenance when it did come from the library. A save carries the
original forward unchanged (no second encode, so no generation loss): the new
record is re-editable again. `stickerRecipeFrom` validates untrusted payloads (a
session written by an older build, an imported file) and answers null unless
every field is there, which is exactly the legacy state, and
`normalizePhotoRecipes` applies that at hydration.

**What the first cut of this lane stored instead** (audit): the maker passed
`imageSrc` (the AI cutout, or the hand-masked result when the user had adjusted
it) into a 960px PNG capture, so `recipe.source` was the *cut*, not the
original. Measured on a 2400x1800 photo: the old field held 960x720 at 583,738
chars with corner alpha **0** (the cutout's transparency), while the picture it
was made from is 1600x1200 at 709,267 chars with corner alpha **255** (the plain
frame). Re-edit could therefore never re-run the cutout; it re-composited pixels
that had already been cut. The field is now the original, and the tests and the
browser run assert the two halves differ.

**The cap, measured.** Re-cutting and re-baking the stored original at several
caps and comparing against a fresh decode of the same file (480px grid, RGBA
mean absolute difference; the same file cut twice is the floor, at 0.0):

| stored original | bytes in the record | mean Δ vs fresh |
| --- | --- | --- |
| 960px PNG (the old field) | 584 KB | 5.98 / 255 |
| 960px JPEG q0.92 | 215 KB | 5.98 / 255 |
| **1600px JPEG q0.92 (shipped)** | **756 KB** | **3.71 / 255** |
| 2048px JPEG q0.92 | 1301 KB | 4.39 / 255 |
| full 2400px JPEG q0.92 | 2229 KB | 0.81 / 255 |
| 1600px PNG | 5227 KB | 1.36 / 255 |

`ORIGINAL_MAX = 1600`: the old 960 cap was measurably lossy (a 1px dimension
shift plus ~2.3% channel error against the fresh decode), 1600 halves that while
staying at a third of the uncapped bytes, and it encodes photos as JPEG q0.92
(PNG at the same size would be 6.9x the bytes for a difference under one 8-bit
step on average). Bigger is not monotonically better either: 2048 costs 545 KB
more than 1600 and lands further from the fresh decode, because the cap is a
byte budget, not a quality dial. A source that may carry alpha (PNG/WebP) is
kept as PNG; the encoder picks by the file's own type.

**Cost in the session.** Measured on that photo: result PNG 1,285,125 B plus
original 709,267 chars ≈ **1.99 MB per re-editable sticker** (a text sticker is
443 KB, no image). Each re-edit copy carries its own copy of the original, so a
sticker re-edited three times stores the original four times; deduplicating
originals by hash is the upgrade path if a library ever gets big. `recordSignature`
in `lib/sessionStore` tracks only *whether* a recipe is present, so the record is
written when the recipe lands, not on every save.

The erase dialog's own layout follows from the small screens it has to survive:
the sticker's editor scrolls (with the app's scroll-edge fade from
`lib/useScrollFade`, so the cut edge reads as "more this way" instead of a
cropped control) while **Cancel and Apply are pinned above the fold in a fixed
footer**, drawn by the dialog rather than inside that scroll body
(`StickerMaskEditor` takes `actions="none"` and hands its commit over as
`MaskEditorHandle.apply()`). The editor's stage is measured in `dvh`
(`min(34dvh, 280px)`), so a 412px-tall landscape phone shrinks the canvas
instead of burying the toolbar; on a 375x812 or 1280x900 window the stage is
within 4px of its old height. The undo depth beside Undo reads `0/20`, which is
cryptic alone: it carries an accessible name and a hover title ("0 of 20 undo
steps") without taking a row.

Both depths **save a NEW record** in the source's folder and never rewrite the
one they came from: `cat.png` becomes `cat (erased).png` or `cat (edited).png`
beside it. That is the snapshot principle again: a placed copy draws the asset
it was placed from, so rewriting the PNG under it would change boards the user
never touched. The two dialogs say so in one line each. Because nothing on a
board changes, **neither action pushes an undo entry** (the undo stance the
folder actions already take): the way back from an edit is deleting the copy it
made, and the original is still in the library. The erased copy carries no
recipe: its pixels are hand work over a finished sticker, not an edit of an
original, so a later Re-edit would silently drop the strokes; Erase is its door,
and Erase again on its own alpha composes.

A `.koma.json` save rebuilds photos from their data URLs without the recipe, so
a sticker imported from a file offers Erase only.

Entry is the top bar's Photo menu (both views), as the one Library item; the
route is `/library`, the page the future hub hangs off.


### Photos

Photos are the other half of the library page. They are the `kind === 'photo'`
assets (absent = photo; a novel kind joins neither list), and every photo
can carry hand-typed **tags**: `Photo.tags` is the membership, many to a photo,
and the tag list itself is session state beside the photos (`photoTags`), so an
empty tag survives a reload and can be renamed or deleted. That list/membership
split is the folder model's, with one deliberate difference: a sticker's folder
has to exist before the sticker can move into one (its chip bar is the only
door), while a tag typed on a photo joins the list on the spot, because tagging
is where tags are invented. Renaming a tag repoints every photo wearing it and
deleting one takes it off them; neither deletes a photo, and neither pushes an
undo entry (library actions, like the folder edits).

```
┌──────────────────────────────────────────────────────────┐
│ Photos 6                                                 │
├──────────────────────────────────────────────────────────┤
│ All 6 · Untagged 1 · trip 2 · home 2            [New tag] │
├──────────────────────────────────────────────────────────┤
│ ▣ ✓Used 1  ▣ Unused  ▣ Unused  ▣ Unused  ▣ Unused         │
│ 2024-05-01 12:34   #trip #home                            │
└──────────────────────────────────────────────────────────┘
```

Each card is the photo (cover-cropped to a contact sheet), a usage badge from
the same derivation the sticker section uses (`referenceCounts` through
`useAssetUses`: every board of every group plus the collage background), the
capture time read from its EXIF, and the tags it wears (each chip filters the
page). The capture time and the GPS fix are read once at import (`probeExif`
beside the dimension probe) and **stored on the library entry and in the
session record**, so the detail block never re-parses a 40 MB file on open and
survives a reload.

The toolbar stacks below `sm` (chips on their own full-width line, the tag
actions under them) rather than sharing one row with them: at 320px two icon
buttons leave the chip scroller ~220px, where the scroll fade's 48px band is a
fifth of the row and the chip at the cut ghosts as a lone border, which reads as
a hard clip. Full width, the fade stays the "more this way" affordance the tools
dock and the sticker folder chips use.

Clicking a card opens the detail dialog: the frame large, the EXIF block (taken,
location, true size, where the board draws it), the tag editor, and delete. The
preview is a floor-heighted box with the image absolutely filling it, so a small
preview (a 1×1 fixture, a screenshot) scales up instead of rendering as its own
pixel, and the frame never collapses to a sliver on a phone. The
location line is the camera's WGS-84 fix resolved against the bundled district
polygons (`lib/regeo`, the lazy 5.6 MB index the text lane already ships), so a
photo from Hangzhou reads as `杭州市西湖区` with no network and the coordinates
stand in until the lookup lands. **Delete is the sticker rule, generalized**:
`retireAsset` in the store runs the same `retirePhoto`/`gcRetired` pair for both
kinds, so a photo a board still draws leaves the list but stays as an orphaned
record and the pane, the preview and the export keep drawing it; the confirm
says so. The import door on the page adds to the library with `autoFill` off:
a library surface does not rearrange whatever board happens to be open.

## The retained launcher (`#/legacy-index`)

A launcher that puts the three surfaces side by side (the board overview, the
library's photos tab, its stickers tab) was drafted while the app's root was
under review. The root went back to the 3×3 overview, and the page is kept at
`#/legacy-index`: routable and fully working, linked from nowhere. It is not in
any menu, no card points at it and no shortcut reaches it, so it stays out of
the main flow; `isHubPath` keeps the board chrome inert there, as on the
library page.

Each card carries the surface's icon, one line about it, how much is in there
(workspaces filled, photos, stickers) and when it was last opened (a
localStorage timestamp per destination, `lib/hubSeen`, recorded on every route
change, so a board visit counts as grid making). The cards follow the workspace
switcher's card idiom (hairline `line` border, `pane-bg` fill, `shadow-pop`, an
outline ring on hover/focus) rather than inventing a launcher style, and a
`Retained draft` chip says what the page is.

`lib/routes` holds the paths and the two predicates the chrome keys off:
`isGridPath` is the overview at `/` (pure navigation, export in batch mode) and
`isHubPath` is "no board is drawn here" (the library, its two redirects, plus
this page). The overview therefore keeps the board key map (`G` toggles, `Esc`
backs out of the editor to `/`) and the floating actions, exactly as before the
draft.

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

## Four implementation notes

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

### 4. Gestures paint the board, React renders it (`src/lib/boardPaint.ts`)

A drag must not cost a render. Panning a photo, pinching it and dragging a
divider change pixels *inside* a pane, or the panes' boxes, and a store commit
per pointermove re-rendered the board, the tools dock and the canvas menu every
frame: on a phone, one gesture ate a whole frame budget while the browser's own
layout of the same change stayed free (panes are absolutely positioned).

So those three gestures write the DOM themselves and commit once, on release
(one undo step, coalesced in `lib/history`). The mapping they write lives in one
module, `lib/boardPaint.ts`, and the JSX uses it too (`paneDraws`,
`paneBoxStyle`, `photoTransform`, `minimapStyles`, `dividerBandStyle`,
`dividerGripStyle`), so a painted frame and a rendered frame are the same frame
by construction: a divider drag's committed layout matches what it painted to
0px, with the crossfade on or off.

What keeps the painted set small is the model: stickers and labels are
board-positioned, so a pane resize does not move them. The photo, its held Live
Photo and its minimap ride the placement and are painted; a render that lands
mid-gesture reads the gesture's draft (`draftRef` in `Pane`, the repaint in
`useDividerDrag`) so it cannot snap the board back to the committed value.

Measured on a 9-pane board at 375×812 with a 6× CPU throttle, script per frame:
pan 12.4ms → 0.7ms, pinch 19.4ms → 0.7ms, divider drag 9.1ms → 0.4ms.

## Layout

```
src/
  router.tsx        code-based routes: / = 3×3 overview, /w/$wsId = editor, /library = the unified photo + sticker library (/photos and /stickers redirect to its tabs), /legacy-index = the retained launcher; hash history (single-file build must work via file://)
  lib/routes.ts      the route paths + the isGridPath / isHubPath predicates the chrome keys off
  lib/hubSeen.ts     per-destination "last opened" timestamps for the retained launcher's cards (localStorage)
  main.tsx          boot: load session → render → debounced autosave + pagehide flush
  lib/panes.ts       pane tree: split/remove/layout/placement, shared by preview and export
  lib/imageStore.ts  three-tier image assets + JPEG/HEIC header probing
  lib/heic.ts        HEIC: meta box probing + WASM decoding (heic-to)
  lib/exporter.ts    high-res rendering (collage + 3×3 board snapshot), file download / clipboard copy, crop report export
  lib/sessionStore.ts   IndexedDB session autosave (workspaces + photos with real File objects)
  lib/stickerLibrary.ts sticker assets: kind / folder / retired markers, usage counts (shared with the photo section), folder CRUD, the retire rule (pure)
  lib/library.ts     the unified library: its kind table, counts, URL type parsing, group picks and name search (pure)
  lib/photoTags.ts   photo tags: membership, tag CRUD, rename / delete fan-out, hydrate normalization (pure)
  lib/assetNames.ts  the name cleaning, cap and case-insensitive compare folders and tags share
  lib/workspaceFile.ts  whole-board save/open: .koma.json with photos as data URLs
  lib/fonts.ts       curated Google Fonts catalog + runtime loading (with mirror fallback) and text measurement
  lib/browser.ts     which WebView the page was opened in (WeChat's UA) + the best-effort escape from it
  components/
    Stage.tsx        canvas: computes layout, renders panes, dividers and the tools panel
    Pane.tsx         one pane: photo, pan/zoom, split buttons, drop target
    TopBar.tsx       category menus (workspace / photo / help) + hidden file inputs
    FloatActions.tsx floating back / split / reset buttons under the top bar
    LibraryDrawer.tsx / Library.tsx
    LegacyIndex.tsx  #/legacy-index: the retained launcher draft (linked from nowhere)
    library/LibraryPage.tsx        #/library: the type filter, query, group picks and the maker
    library/LibraryHeader.tsx      back, title, total, search, add photos, new sticker, type chips
    library/PhotoLibrarySection.tsx   the photos half: heading, tag chips, grid, detail
    library/StickerLibrarySection.tsx the stickers half: heading, folder chips, grid, move / delete
    library/chips.ts               the chip / tool styles both halves share
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
`/w/$wsId` the editor, and `/library` the one photo + sticker library, with its
type in the query (`?type=photo` / `?type=sticker`, absent = both); `/photos`
and `/stickers` redirect to their tab, and an unknown workspace id redirects to
`/`. The library is a page of its own rather than a drawer over the board: it
draws its own chrome (no floating board actions, and the board's key map is
inert there), and its back chip returns wherever it was opened from. The
board's drawer stays photo-only. `#/legacy-index` holds the
retained launcher draft (see above), reachable by URL only. The view no longer
lives in the store: the route is the view; the route param drives `activeId`.
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
bun run build         # bun check + vite build (regular chunked bundle)
bun run build:single  # bun check + vite build --mode single → koma.html
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
