# Panes: the tree, the corner handle, the size rail, labels

Why-notes for the pane model and its two resize controls. Code and tests own
what the behavior is (`lib/panes.ts`, `lib/scaleRail.ts`, `ui/TickScale`);
these notes hold what the code cannot say.

## Why a binary tree, not a row/column grid

The board is a binary tree of `Leaf` nodes (photo, placement, decorations) and
`Split` nodes (direction, ratio, two children) in `lib/panes.ts`. `'row'`
splits left/right, `'column'` splits top/bottom.

One property decides the shape. Each divider belongs to exactly one split
node. Dragging it redistributes `ratio` between that node's two subtrees only;
panes outside and inside are untouched. A row/column grid cannot do this.
Dragging there moves whole rows.

## Why the corner handle wraps around the pointer

The canvas is centered in the workspace, so every size change of Δ gives Δ/2
back to each side. Mapping raw drag deltas to size makes the handle lag behind
the pointer by half. Instead the handle maps "pointer offset from canvas
center = half width/height":

```ts
hx = clientX - centerX
hy = clientY - centerY
ratio = hx / hy
fill = 2 * hx / fitCanvas(ratio, avail).W
```

Away from the bounds, `fill` makes the displayed size exactly `2*(hx,hy)`, so
the canvas corner sits precisely under the pointer. The grab records
`canvas corner − pointer` rather than leaning on the pointer alone: measured
from the corner, a press changes nothing (no snap), and the same offset still
carries when the tools sheet has lifted the handle off the corner. At the
bounds (`MIN_CANVAS_FILL` / `MAX_CANVAS_FILL`) the canvas stops, and the
handle feels "stuck".

`canvasFill` only affects how large the canvas appears in the preview. It does
not affect export: resolution is the fixed 2048px long edge (`longSide` in
`store.ts`), and the ratio comes from `ratio`.

## Two resize controls, two jobs

The corner handle is the direct gesture: a chip straddling the canvas's
bottom-right corner that reshapes the aspect to anything. It is board chrome
and rides the canvas and the view zoom. It is allowed to be unreachable, a
tall canvas running under the tools sheet and a canvas scaled past the fit
taking its corner off the stage entirely, because the rail is the control
that always is.

The rail is the always-reachable one: a vertical control on the stage's right
edge, centred on the strip the floating chrome leaves free. It never moves
with the canvas or the view zoom, and it sizes whatever is selected
(`lib/scaleTarget`): a selected label first, then a selected sticker, then the
canvas, focused or not. The two objects scale uniformly, which is exactly what
one scale is; the canvas's aspect belongs to the handle. With nothing selected
it still sizes the canvas, so it is never inert.

The handle and the ratio tools write `canvasRatio`; the rail and the wheel on
the stage's air write `canvasFill`, which multiplies both edges and leaves the
ratio alone. A board still following its first photo keeps following it.

## The rail is a graduated scale

`lib/scaleRail` decides the numbers, with tests:

- **The ladder** (`railTicks`). Every step of the target's line while the
  marks stay at least 9px apart, then fifths, quarters or halves as the track
  shortens. Every five steps is a longer mark, and the landmarks (both bounds
  and the natural stop) are placed first, so the grid fills in around them: a
  label's default size is not on the tenths grid, and that is exactly the mark
  the eye looks for.
- **The feel of passing them.** Marks within 52px of the bar light up and grow
  to 1.45× their length. The scale is drawn in the `float` tone, not the
  accent (an accent hairline is near-black in the light theme, the wrong
  colour over a dark photo), and drawn twice: a glass underlay a pixel wider,
  then the mark. The underlay is what survives a near-black photo, where a
  mark alone is only ~1.5:1.
- **The trail.** A moving bar drags a wake whose length is the speed. A
  steady 700px/s drag trails about 85px; a bar that stops leaves nothing,
  because below `WAKE_MIN` px the streak is not drawn (a CSS transition would
  park a duplicate under it instead). The streak is written per frame on the
  element rather than through React state, so the wake never re-renders the
  board. The tail eases with `WAKE_TAU` at 120ms. Hidden under reduced motion.
- **The fit's magnetism.** Only the canvas line has a magnet, because the
  stage fit is worth landing on exactly. Inside ±4 points the mapping leans
  toward the stop (0.7 of the distance removed at the stop, nothing at the
  band's edge, so the map stays monotonic), and a release inside ±2 takes it
  exactly. Measured: a drag released at 102% or 98% lands on 100%; at 104.5%
  it keeps 104.5%. A sticker or a label passes straight through its own
  default: that is a double-click away, not a detent worth feeling on every
  drag.
- **The ends give.** Past either bound the bar keeps moving up to 14px
  (tanh, so it is smooth at 0 and asymptotic at the end), then springs back on
  release. The target is already clamped; the give is the bar's, which is the
  difference between "stuck" and "this is the end".

Each target brings its own line and readout: the canvas reads as a percentage
of the stage fit, a sticker as its share of the canvas's short edge, a label
as its own text size. The canvas line's fit mark sits at 0.63 of the bar's
travel, which is what gives a drag upward somewhere to go (`MAX_CANVAS_FILL`
1.5 enlarges past the fit and lets the stage crop it, `MIN_CANVAS_FILL` 0.15
shrinks it). The same `ui/TickScale` draws the rotate dial, so the two scales
cannot drift into two designs.

A press anywhere on the band grabs the value where it is and drags it
relatively, the way a finger on a camera's zoom scale does. The mapping uses
the rail's own `getBoundingClientRect`, not the stage's measured centre: the
pointer arrives in viewport px, and mixing the two spaces shifted every press
by the stage's offset (measured: a press read the track 31px higher and jumped
the canvas to 83%).

The rail is a real `role="slider"`: arrows walk the ladder one mark, Shift or
PageUp a page, Home/End the bounds, and `aria-valuetext` reads the value under
the target's own name. Left alone it tucks to a stub around the bar with one
clip-path on the whole scale, so the marks it keeps still show the size and
nothing is re-laid-out as it grows. The first tap on a stub opens the rail and
grabs the value in one move, with nothing resized until the finger travels.

## Multi-line text labels

A label is a free-placed board object, not an authored text box, so its text
breaks only at explicit newlines: no auto-wrap. Auto-wrap would make a line's
break depend on the current font size and the board's pixel size, and the
preview and the exporter would break the same string differently at different
scales. On commit every line is trimmed and blank lines at either end are
dropped; blank lines inside survive as deliberate paragraph gaps.

`align` aligns each line inside the box, whose width is the widest line.
Preview and export share one placement rule: the DOM's shrink-wrapped block
uses CSS `text-align`, and `drawLabel` uses `labelAlignOffset` on canvas
measurements of the same lines. The parity is measured in the browser (a
three-line left-aligned label: per-line x within 1px of the exported PNG).
