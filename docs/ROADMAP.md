# koma roadmap

Items are grouped into **waves by change surface** (which files they touch), so each wave runs as 2–3 parallel worktrees without cherry-pick conflicts. Within a wave everything is parallel; between waves we merge, verify (`bun run build` + `bun test src`), then start the next wave.

Prioritization axes: **value × change surface**. Priority ≠ dependency. Shared-bottleneck files (`store.ts`, `exporter.ts`, `router.tsx`, the locale dictionaries) serialize the items that touch them.

## Shipped

- Panel create/close transitions
- Whole-panel background setting
- AI one-click background removal for collage photos
- Mobile headerbar layout on small screens

## Wave 1: foundations

- **Undo/redo** (`store.ts`, command entry points): snapshot history over workspace mutations; session-only, capped. Must land first: every later feature adds new state mutations whose history support compounds.
- **Export fixes** (`exporter.ts`, `exportRun.ts`): reproduce the "rectangle resize exports original size" report (close as cannot-reproduce if it doesn't reproduce), then fix export seams without cross-fade blurring.
- **Vite devtools** (`vite.config.ts`): dev-only plugin; filler item.

## Wave 2: drawer / panel UX

- **Detent rotation common component** + pane rotation/flip (`panes.ts`, `Pane.tsx`): every later rotation UI reuses it.
- **Dock rework** (`ToolsDock.tsx`, `toolsDockMode.ts`, `dockPhysics.ts`): whole-drawer drag gesture, fix text-insert tools display, drop the minimized state for the three display modes, ratio control when nothing is selected. One agent owns the dock.
- **Dual 9-grid comparison** (`workspaces.ts`, `WorkspaceGrid.tsx`, `Stage.tsx`).

## Wave 3: content features (read-only on the exporter)

- **Filters / stylization** (new `filters.ts`, pane render, export render path).
- **Text: multi-line + alignment; photo geolocation pin** (`BoardInserts.tsx`, new `exif.ts`): `exif.ts` is extracted here as the shared EXIF library the map feature reuses.
- **Sticker effects** (`StickerMakerDialog.tsx`, `sticker.ts`): irregular white border, wrinkled-paper texture, stamp stickers.

## Wave 4: asset management

- **Library → album**: independent route, in-use status, photo details, manual tagging (`Library.tsx`, `imageStore.ts`, `router.tsx`).
- **Sticker management page**: CRUD, categories (`sticker.ts`, `router.tsx`, union-merge expected).
- **tldraw integration** (feasibility spike first).
- Jev AI classification lands after the album structure exists.

## Wave 5: steady-state cross-cutting (broad but shallow)

- **Japanese locale** (new `ja.ts`; eslint i18n coverage is the acceptance gate): after UI-string churn settles.
- **UI transparency pass** (`theme.ts`, `buttonStyles.ts`).
- **Storybook scaffold**: after the component set stabilizes.

## Wave 6: share-image generators

- **Spotify cover + lyrics cards**: feasibility spike first (API access, lyrics licensing).
- **Map route cards** (reuses `exif.ts`): spike on map rendering choice.

## Side tracks (parallel anytime, zero `src/` overlap)

- **Website**: landing page + video, roadmap board (feed it from this file), release notes, feedback.
- **Accounts + cloud sync / void deployment**: one design decision, not a coding task. Run a feasibility comparison (void vs current Cloudflare deploy, backend shape for sync/sharing) and decide before scheduling implementation.

## Rules of engagement

- 2–3 code agents per wave, one worktree each, fresh agent per item; parent reviews every diff.
- Anything touching `exporter.ts` is serialized across waves.
- Locale work lands when UI strings are stable.
- Merge: commit everything in the worktree (`git add -A`), cherry-pick into main, keep-both on conflicts, verify, remove the worktree.
