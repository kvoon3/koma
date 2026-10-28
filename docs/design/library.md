# Library: stickers, photos, tags, and the offline place lookup

Why-notes for the library domain. Code and tests own what the behavior is
(`lib/stickerLibrary.ts`, `lib/library.ts`, `lib/photoTags.ts`,
`lib/stickerRecipe.ts`, `lib/regeo.ts`); these notes hold what the code
cannot say.

## A sticker is a library asset of its own

`Photo` carries the marker: `kind: 'sticker'` (absent = photo, which is what
every session saved before this reads as), a one-level `folder` (absent =
Unsorted), and `orphaned` for an asset deleted while a placed copy still
draws it. The folder list is session state beside the photos
(`stickerFolders`), so an empty folder survives a reload; a rename repoints
the stickers in the same commit.

**Usage is derived, never stored.** Every board of every group is scanned for
photo ids (pane photos, pane stickers, board stickers, plus the collage
background), and the count is what the badge shows. Labels contribute
nothing: their icons are catalog ids, not photos.

**Delete removes the asset and keeps the drawing.** Preview and export
resolve a sticker through the photos map, so dropping the record would blank
a placed copy. On delete the session counts every reference it still holds:
all groups' boards, the background, the pane clipboard, and both undo and
redo stacks, since an undo can restore a pane that draws it. With none the
record is dropped; with any it is kept as an `orphaned` record no list shows
and every draw still resolves. Orphans are swept at hydration, the one moment
the history is empty, so nothing can want them back.

Folder moves, renames and deletes are library actions, outside the board
history, so one ⌘Z after sorting still undoes the last board change.
Deletion is the one destructive library action, so it confirms, and the
confirm says what survives. Deleting a folder never deletes stickers: they
fall back to Unsorted.

The import door on the library page adds to the library with `autoFill` off:
a library surface does not rearrange whatever board happens to be open.

## One maker, two doors

`StickerMakerDialog` takes a `StickerTarget` (`lib/stickerAssets`) and only
its save branches: `pane` bakes and pins onto the board (the editor's Make
tool, one undo step), `library` bakes and files under the folder (the page's
New sticker, no board touched, no undo entry). Every road into the maker,
file pick, library photo, drawer grid or camera still, passes the same
`loadFile(File)` door, so the cutout, the edge effects and the mask editor
are the same code. The board host keeps the dialog mounted so reopening
keeps the last pick; the library host remounts it per opening, so a new
sticker starts from an empty stage.

**Paper texture is one segmented choice, None or Newspaper, no strength.** It
runs in `prepareArtwork` after the visible-pixel crop and before
`applySilhouette`, so the white die-cut border and the stamp punches stay
clean and the distance field still reads the source alpha. The cell pitch is
4 display pixels, the stage's drawn long edge and the same length the stamp
sliders read, so the 480px preview and the 960px save are the same printed
sheet at two scales. The recipe stores the pick in `style.texture`; any other
shape is rejected by the validator, and null is byte-identical to no print.
The print is pure `lib/stickerTexture` and is tested under Bun.

## Erase and Re-edit: two depths of editing an existing sticker

A saved sticker is the composited PNG (cutout, border and perforation baked
in), so there are exactly two things the library can offer over it, and the
difference is whether the maker's inputs still exist:

- **Erase** paints the sticker's own alpha: the maker's `StickerMaskEditor`
  over the final PNG. Nothing but the record's pixels is needed, so it is
  offered on every sticker, including every one made before this existed.
  Only the dialog shell is new code; the editor, its undo stack and its
  commit are shared with the maker's Adjust cutout.
- **Re-edit** means edit again from the start: the maker reopens on the
  ORIGINAL picture the sticker was started from, re-runs the AI cutout, and
  loads the saved style as the starting values of the controls, with a Reset
  effects button. Nothing is inherited from the finished pixels except the
  style numbers. It needs `Photo.recipe`; a legacy asset has none and the
  card does not draw the button.

Both save a NEW record in the source's folder and never rewrite the one they
came from (`cat.png` becomes `cat (erased).png` beside it). That is the
snapshot principle: a placed copy draws the asset it was placed from, so
rewriting the PNG under it would change boards the user never touched.
Because nothing on a board changes, neither action pushes an undo entry. The
erased copy carries no recipe: its pixels are hand work over a finished
sticker, so a later Re-edit would silently drop the strokes; Erase is its
door, and Erase again on its own alpha composes.

## The sticker item stores a pair: the original and the result

The result is the record itself (its `Photo.file`, the composited PNG). The
original is `Photo.recipe.original`, written once at save time by
`addStickerAsset`:

```ts
type StickerOriginal
  = | { type: 'text', text: string, color: string, fontId: string } // no image exists: the spec is the original
    | { type: 'image', src: string, name: string, photoId?: string } // the un-cut photo, data URL ≤ 1600px

interface StickerRecipe {
  original: StickerOriginal
  style: StickerBakeStyle
}
```

The image original is the picture the user picked, before any cutout, border
or material: a subject may come from a file that was never imported, and a
photo id would describe neither that nor a file the library later lost, while
an object URL dies with the dialog. `photoId` rides along as provenance when
it did come from the library. A save carries the original forward unchanged
(no second encode, so no generation loss): the new record is re-editable
again. `stickerRecipeFrom` validates untrusted payloads and answers null
unless every field is there, which is exactly the legacy state.

**Audit: what the first cut of this lane stored instead.** The maker passed
`imageSrc` (the AI cutout, or the hand-masked result when the user had
adjusted it) into a 960px PNG capture, so `recipe.source` was the cut, not
the original. Measured on a 2400×1800 photo: the old field held 960×720 at
583,738 chars with corner alpha 0 (the cutout's transparency), while the
picture it was made from is 1600×1200 at 709,267 chars with corner alpha 255
(the plain frame). Re-edit could therefore never re-run the cutout; it
re-composited pixels that had already been cut. The field is now the
original, and the tests and the browser run assert the two halves differ.

**The cap, measured.** Re-cutting and re-baking the stored original at
several caps and comparing against a fresh decode of the same file (480px
grid, RGBA mean absolute difference; the same file cut twice is the floor, at
0.0):

| stored original | bytes in the record | mean Δ vs fresh |
| --- | --- | --- |
| 960px PNG (the old field) | 584 KB | 5.98 / 255 |
| 960px JPEG q0.92 | 215 KB | 5.98 / 255 |
| **1600px JPEG q0.92 (shipped)** | **756 KB** | **3.71 / 255** |
| 2048px JPEG q0.92 | 1301 KB | 4.39 / 255 |
| full 2400px JPEG q0.92 | 2229 KB | 0.81 / 255 |
| 1600px PNG | 5227 KB | 1.36 / 255 |

`ORIGINAL_MAX = 1600`: the old 960 cap was measurably lossy (a 1px dimension
shift plus ~2.3% channel error against the fresh decode), and 1600 halves
that while staying at a third of the uncapped bytes. Bigger is not
monotonically better either: 2048 costs 545 KB more than 1600 and lands
further from the fresh decode, because the cap is a byte budget, not a
quality dial. A source that may carry alpha is kept as PNG; the encoder picks
by the file's own type.

**Cost in the session.** Measured on that photo: result PNG 1,285,125 B plus
original 709,267 chars ≈ 1.99 MB per re-editable sticker (a text sticker is
443 KB, no image). Each re-edit copy carries its own copy of the original, so
a sticker re-edited three times stores the original four times;
deduplicating originals by hash is the upgrade path if a library ever gets
big. `recordSignature` in `lib/sessionStore` tracks only whether a recipe is
present, so the record is written when the recipe lands, not on every save.

## Photos and tags

Photos are the `kind === 'photo'` assets, and every photo can carry
hand-typed tags: `Photo.tags` is the membership, the tag list itself is
session state beside the photos (`photoTags`), so an empty tag survives a
reload and can be renamed or deleted. That list/membership split is the
folder model's, with one deliberate difference: a sticker's folder has to
exist before the sticker can move into one (its chip bar is the only door),
while a tag typed on a photo joins the list on the spot, because tagging is
where tags are invented.

The capture time and the GPS fix are read once at import (`probeExif` beside
the dimension probe) and stored on the library entry and in the session
record, so the detail block never re-parses a 40 MB file on open and survives
a reload.

**Delete is the sticker rule, generalized.** `retireAsset` in the store runs
the same `retirePhoto`/`gcRetired` pair for both kinds, so a photo a board
still draws leaves the list but stays as an orphaned record, and the pane,
the preview and the export keep drawing it.

## Photo location, offline

Importing a JPEG also reads its APP1 Exif header (`lib/exif.ts`, zero
dependencies, bounded and non-throwing): the GPS IFD's DMS rationals plus the
N/S/E/W refs give a WGS-84 fix, `DateTimeOriginal` gives the capture time.
HEIC and PNG carry no EXIF in this path, so they simply have no fix.

Reverse geocoding is offline. `scripts/build-districts.mjs` downloads the
AreaCity `ok_geo.csv` (MIT, see `THIRD_PARTY_NOTICES.md`) into the OS temp
dir (the archive is never committed), keeps the province / city / district
rows, converts their GCJ-02 points to WGS-84 once and Douglas-Peucker
simplifies each ring (~500 m for districts, coarser for the province / city
fallback). The result is `src/data/districts.json` (5.4 MB), imported lazily
by `lib/regeo.ts` on the first Location insert: a 0.5° coarse grid
pre-filters candidate polygons, even-odd point-in-polygon picks the deepest
hit. Nothing about a normal board load touches the file.
