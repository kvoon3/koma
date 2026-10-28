# Export: one math, three-tier assets, and the delivery dialog

Why-notes for exporting and image memory. Code and tests own what the
behavior is (`lib/exporter.ts`, `lib/imageStore.ts`, `lib/heic.ts`,
`components/ExportDialog.tsx`); these notes hold what the code cannot say.

## Preview and export share one math (`lib/panes.ts`)

`layoutTree()`, `placement()` and the sticker `stickerRect()` are called by
both the renderer and the exporter, with different W/H. Decorative sizes
(gap, radius) are per-mille of the canvas short edge, not pixels, and scale
by `canvas short edge / 1000`, so exporting at 1080 or 6000 looks identical.
Text labels follow the same rule through the shared `labelRect()`, sized in ‰
of the short edge, so a label sits identically at any export resolution,
including on panes with no photo at all.

Rotation rides the same rule: both sides turn about their center, the angle
is stored in radians and wrapped to (-π, π], and a rotated sticker's resize
handle anchors on the rotated opposite corner, so it still scales along the
diagonal the user sees. A pane's photo is framed by `paneTransform()`, which
turns about the pane center and grows by `rotationCoverScale()` so a turn
never leaves empty corners (√2 at 45° on a square); the preview reads it as
`rotate() scale()` on a layer inside the clip, the exporter as
`ctx.rotate`/`ctx.scale` inside the pane clip. The seam feather stays in pane
space on both: the preview masks the clip wrapper, the exporter feathers a
pane-sized scratch after turning.

Key invariant:

```
drawn width w = iw × max(cw/iw, ch/ih) × zoom = max(cw, ch·iw/ih) × zoom
```

independent of the image's own pixel size: a 1800px preview image and the
6000px original produce the identical drawn rectangle.

With "transparent" gap fill the export switches to PNG (JPEG cannot store
alpha).

## Three-tier image assets (`lib/imageStore.ts`)

A decoded 6000×4000 JPEG is 96MB of memory; using it directly for a few
previews will crush the browser tab.

| Tier | Size | Created when |
|---|---|---|
| thumb | ~220px | Thumbnail scrolls into view (IntersectionObserver) |
| preview | ~1800px | Photo enters a pane; original released right after |
| file | original File | Decoded only at export, `close()`d right after drawing |

Measured: three resident 24MP photos keep heap usage around 10MB.

HEIC decoding is the expensive path (a 48MP frame moves ~190MB of ImageData
out of the WASM worker), so it is kept on a leash: the thumb and preview jobs
share one refcounted full-res decode per photo (a thumb is shrunk from the
cached preview when one exists); WASM decodes run one at a time through a
two-priority queue, interactive previews and export jumping ahead of queued
library thumbs, equal priorities FIFO and a running decode never preempted;
encodes go through async `toBlob` + object URLs instead of synchronous
`toDataURL`. Export acquires each unique photo's full source once per run and
releases every source only after the last draw. Safari additionally gets a
native `createImageBitmap` fast path (hardware HEIC decode, no WASM at all);
one failed attempt permanently falls back to libheif.

## Real dimensions without decoding

`probeJpeg()` parses the JPEG SOF marker (plus EXIF orientation to swap
width/height when needed), reading only the first 256KB of the file;
`probeHeic()` parses `ispe` (dimensions) and `irot` (rotation, where iPhone
portrait shots store it) from the meta box. Orders of magnitude faster than
decoding a 24MP frame, so the canvas ratio is decided the instant a photo is
added and `trueW`/`trueH` are available before the preview exists. Neither
probe decodes pixels or touches WASM.

The HEIC decoder (heic-to, libheif compiled to WASM) is dynamically imported
and warmed the moment a dropped set contains a HEIC, so its parse overlaps
probing and rendering: it only loads when an actual HEIC is encountered,
costing pure JPEG/PNG users nothing.

## Why exports land in a dialog

Rendering is the slow half and happens first; the finished run lands in a
dialog rather than straight in the Downloads folder, because the browsers
that matter most here are the ones that block or bury a programmatic
download: WeChat's WebView on a phone, where saving an exported blob either
fails or vanishes, and iOS Safari, where it drops into Files instead of the
photo library.

- **Nothing is saved unasked**: the dialog is the delivery step, so the user
  sees exactly what is about to be written, at what size and in what format.
- The still sits on the transparency checkerboard on purpose, and
  `.export-shot` restores `-webkit-touch-callout` and `user-select`, which
  the app switches off globally so a long-press cannot loupe over the canvas:
  press-and-hold then raises the platform's own save sheet.
- **Copy image** writes PNG through `copyImageToClipboard()`: JPEG stills are
  re-encoded, because clipboard implementations only reliably take
  `image/png`, and a PNG still keeps a transparent gap fill transparent. The
  `ClipboardItem` is built and `write()` called before the encode resolves,
  which is the only shape Safari keeps its user gesture for.
- One run per non-empty workspace in the grid view, and Download all is
  staggered, because browsers throttle a burst of downloads from one gesture.
- A Live Photo adds its recorded video as the item right after its still.
- Escape (or the backdrop) dismisses without touching the board: the global
  shortcut handler yields while the dialog is open, so Escape closes the
  dialog and does not back out of the editor behind it.
- The run owns its preview object URLs (`showRun` / `dropRun` in
  `router.tsx`), not the dialog instance, so a remount can never blank a
  preview that is still on screen; they are released once the close
  transition has finished painting.

## Zoom and the minimap (`lib/exportView.ts`, `components/ExportPreview.tsx`)

A 2048-long-side export lands in a ~696 × 560 stage at about 0.34 CSS px per
image px, fine for the whole board and useless for a seam. So the still zooms,
and the view is `{scale, cx, cy}` in image fractions: `cx`,`cy` is the image
point under the viewport's centre. Fractions make a resize, a rotation and a
scroll free, because the transform and the minimap's window are re-derived
from the same three numbers; only their legality depends on the box. One
private clamp (`clampExportView`) is where the write and the read path both
end, so a view a resize made stale is re-clamped on the way out, not fixed by
an effect. `zoomed`, the presence of `transform` and the viewport's
`touch-none` class are one predicate, so a fitted render cannot own the
pointer.

The top of the range is the native-pixel rule, not a round number: at fit an
image pixel is `fit / image` CSS px, so 1:1 is `1 / fitRatio`, capped at 8. An
export already drawn larger than its own pixels has a ceiling of 1, so the
feature stays inert for it: the right answer for an inspection tool.

The save path shapes every gesture. Handlers sit on the viewport div, never on
the img, and at fit a single pointer gets no capture and no `preventDefault`,
so the img keeps its long-press sheet and its desktop drag. `preventDefault`
runs at exactly three places: the wheel, and a pointerdown that starts a pan
or a pinch. A non-passive `touchstart`/`touchmove` also refuses the page zoom
while two touches are down, because a pinch that starts at fit begins under
`touch-action: auto`. The chip seats top-right and returns to fit; the
minimap seats bottom-right, its rect drawn from the same window as the
transform. The lifecycle is React's key alone: `ExportPreview` mounts with
`key={item?.url}`, and a new run, a strip switch and a close all change that
identity, so there is no reset API, no store field and no history step.
