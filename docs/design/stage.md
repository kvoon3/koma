# Stage: the air, painted gestures, chrome decisions, grid groups

Why-notes for the stage and its chrome. Code and tests own what the behavior
is (`lib/canvasView.ts`, `lib/boardPaint.ts`, `components/grid/`); these notes
hold what the code cannot say.

## The stage's air: the wheel sizes the canvas, ⌘-wheel zooms the view

The stage and the grid overview are the same beast: a board centred on a
checker stage with air around it. In the editor the plain wheel on that air
sizes the canvas itself (`canvasFill`, 1.1× a notch, clamped 0.15 to the fit).
Ctrl/meta + wheel, which is also how a trackpad pinch arrives, scales the
whole canvas as a view, a CSS `transform: scale()` about its centre, clamped
0.25–2.5 (`VIEW_MIN` / `VIEW_MAX` in `lib/canvasView.ts`). The view is session
working state only: not in a workspace, not in the undo history, not
persisted, reset to fit on a route change.

The object under the gesture is the canvas, because the air is outside the
canvas, and `canvasFill` is exactly what "the canvas's size" means here
(width and height together, the aspect left to the corner handle). Editing
the pane tree from outside the canvas, with no handle under the pointer,
would rearrange the collage under an unrelated gesture, and the dividers
already own that.

The wheel's range stops at the fit for a practical as well as a compositional
reason. A canvas scaled past the fit covers the air the gesture lives on, so a
wheel that could bleed would eat its own surface and then silently become a
photo zoom under the same pointer. The wheel is never silent about the bound:
the stage hands the rail a nudge on every notch, and at a bound the readout
shows the value pinned, which is the answer to "why did nothing happen".

Composition with the board's own gestures:

- Hit testing needs no correction: clicks, buttons and drop targets are mapped
  by the browser through the transform, so everything that hit-tests natively
  works untouched.
- Pointer math does: every gesture that turns client pixels into canvas pixels
  divides by `viewScaleAt(node)`, read from the nearest wrapper's
  `data-canvas-view` attribute (no context, no re-render on a wheel notch).
  Ratios are scale-free and stay as they are: label drags, rotations, the
  minimap's own mapping.
- dnd-kit does: its translate is measured in screen pixels while the cells are
  laid out in canvas pixels, so the sortable's transform is divided back by
  the scale, the drag ghost is drawn at the scaled size, and collisions are
  decided by `pointerWithin` first with `closestCenter` as the gap fallback.
  Measured at 0.5: a cell dragged onto its neighbour's centre lands in that
  slot, and a 40px pointer drag on a divider moves it 40px on screen.

Trade-off, now behind an explicit modifier: zooming the view in grows the
canvas over the stage's air, so past ~1.15 there is no margin left to
⌘-wheel on, and the percentage chip is the way back to fit.

## Gestures paint the board, React renders it (`lib/boardPaint.ts`)

Panning a photo, pinching it and dragging a divider change pixels inside a
pane, or the panes' boxes. A store commit per pointermove re-rendered the
board, the tools dock and the canvas menu every frame: on a phone, one
gesture ate a whole frame budget while the browser's own layout of the same
change stayed free (panes are absolutely positioned).

So those three gestures write the DOM themselves and commit once, on release
(one undo step, coalesced in `lib/history`). The mapping they write lives in
one module, and the JSX uses it too (`paneDraws`, `paneBoxStyle`,
`photoTransform`, `minimapStyles`, `dividerBandStyle`, `dividerGripStyle`),
so a painted frame and a rendered frame are the same frame by construction: a
divider drag's committed layout matches what it painted to 0px.

What keeps the painted set small is the model: stickers and labels are
board-positioned, so a pane resize does not move them. A render that lands
mid-gesture reads the gesture's draft (`draftRef` in `Pane`, the repaint in
`useDividerDrag`) so it cannot snap the board back to the committed value.

Measured on a 9-pane board at 375×812 with a 6× CPU throttle, script per
frame: pan 12.4ms → 0.7ms, pinch 19.4ms → 0.7ms, divider drag 9.1ms → 0.4ms.

## Chrome decisions

- **Grips draw one layer above every line.** The usual 50/50 split puts a
  full-height divider's midpoint exactly on the crossing divider's line,
  which would slice the pill in half. The layer is a sibling of the bands
  rather than a child, so the hover that lights a grip is tracked in React,
  not through `group-hover`.
- **The minimap parks at the corner of the photo's visible rect**, 20px in,
  never at the pane's corner: a zoomed-out photo pulls the chip in with it.
  The 20px (not the 8px the corner alone wants) clears the canvas aspect
  handle, which reaches 14px inside the canvas corner. Below lg it seats
  against the tools dock instead, measured from the dock's own rect rather
  than the viewport, and is portalled outside the canvas transform so the
  seat holds at every view zoom.
- **The wordmark is a four-glyph font subset** (1.4KB, OFL, in
  `assets/fonts/`), so it paints in the first frame, offline, with no CDN
  face to swap in behind it. As inline SVG paths the same letters are 2.1KB
  raw, and either alternative trades a font edit for an asset that has to be
  regenerated by hand.
- **The Photo and Help menus hand over on hover** while one is open, and the
  settings popover takes part in the same hand-over. A category menu lays a
  modal backdrop over the rest of the bar while open, which would swallow the
  pointer before it reached the next panel's trigger; `TopBar` therefore
  watches the window's pointer and hit-tests the triggers marked
  `data-bar-trigger` through that backdrop.
- **Below `sm` the stats give way, not the byline.** The two stats already
  fill a 360px phone, and a credit that shrinks to a bare heart credits no
  one.
- **The split chip has two copies with a rule.** The pane's own hover chip
  serves from lg up; below, the page-row chip is what a phone keeps, a touch
  screen having no hover to fade the pane's copy in.
- **The stage bounds every board against chrome it must not grow under**
  (`DOCK_CHROME_H`): the board's caption row and the tools dock's sheet. The
  budget is what keeps a third row of cells off the dock instead of under it.
- **The board chips sit on the caption row, centred**, because groups render
  nameless: there is nothing to name on the left, and a name would shove the
  pair off-centre. The chips sit on the board they act on instead of
  floating over it.

## Grid groups (workspaces)

A board is a group of nine, and the app keeps up to four (`MAX_GRIDS`) as
alternate arrangements of the same shoot.

- **The strip is browse-only.** It scrolls and snaps and never switches the
  group, so the ring always marks the open one and the board pager is the one
  way to change it. Adding a group copies the open board (photos shared
  through the library, every pane / sticker / label id fresh, see
  `cloneNode`); deleting never takes the last one. Adding and deleting ride
  the undo stack; switching is navigation and pushes nothing.
- **The receded board is the finger path.** Dragging it sideways moves the
  boards 1:1 as one plane, and `lib/boardPager` reuses `lib/dockPhysics`'s
  rules: the same fling threshold, the same snap picker, and the dock's
  rubber band at 0.3x for the first and last group, whose edges have no board
  behind them. A release that lands on a neighbour switches the open group
  through `switchGrid`.
- **Entry and exit are navigation, not a route.** The morph rides view
  transitions (the board column carries the `ws-board` transition name, the
  strip is its own `ws-strip` pair); a downward pull opens, a pull up, a tap
  or Esc closes, on one axis lock so neither gesture steals the other early.
  `prefers-reduced-motion` makes the settle instant, while the drag itself
  stays 1:1, because user-driven motion is not decoration.
- **Store shape.** The open group's cells live in `workspaces`, so every
  reader of "the board" keeps working; the other groups' boards live in
  `parkedBoards`, and opening a group swaps the two. The session saves one
  entry per group beside the open board's `workspaces`, so a session written
  before groups loads as group 1 with every cell intact, and a build from
  before groups still reads the board it saved. A group's `name` stays in the
  model for compatibility, but nothing renders or edits it.
