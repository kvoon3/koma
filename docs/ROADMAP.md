# koma roadmap

Items are grouped into **waves by change surface** (which files they touch), so each wave runs as 2–3 parallel worktrees without cherry-pick conflicts. Within a wave everything is parallel; between waves we merge, verify (`bun run build` + `bun test src`), then start the next wave.

Prioritization axes: **value × change surface**. Priority ≠ dependency. Shared-bottleneck files (`store.ts`, `exporter.ts`, `router.tsx`, the locale dictionaries) serialize the items that touch them.

## Shipped

- Panel create/close transitions
- Whole-panel background setting
- AI one-click background removal for collage photos
- Mobile headerbar layout on small screens
- Undo/redo: snapshot history, ⌘Z / ⇧⌘Z, gesture coalescing (Wave 1)
- "Rectangle export keeps the square size" closed as cannot-reproduce; the size contract is pinned by tests. Note: the grid snapshot intentionally exports square cells.
- Export seam: Safari-only (not reproducible in Chromium). The flush-draw fix was reverted; the crossfade workaround stays until the Safari root cause is found.
- Vite devtools (`@vitejs/devtools`, dev-only) (Wave 1)

## Shipped in Wave 2 (PRs #29/#30/#31)

- Detent rotation for pane photos: reusable dial, stepless drag with detent magnetism, flips, undo-coalesced gestures
- Tools-drawer rework: three displays with live mode-switching mid-drag, FLIP item glides, whole-drawer drag, scroll preservation, list-swap slide, edge fade
- Workspaces: Mission Control-style switcher (pull-down in / pull-up out, 1:1 board pager, read-only strip, nameless cards), grid groups with copy-on-add, WorkspaceGrid split into components/grid/
- Vision acceptance pipeline (judge at 375px + 1280px) recorded in AGENTS.md; i18n drift test; UNDOABLE_PATCH_KEYS derived from the snapshot

## Tech-debt wave (shipped, PRs #32/#33/#34)

- router.tsx export flow + key map extracted (687 → 274 lines)
- store.ts split along its seams (1480 → 1211; layout/photoLibrary/settingsStore in lib/)
- exporter decoupled from the store; motionTokens single source; paneCommands one job
- Follow-up (M): the four store-reading command modules; action factories to shrink store.ts further

- router.tsx: extract ~250 lines of export orchestration to lib/exportFlow.ts; split the keyboard map into a hook (M)
- store.ts: split along the seams into lib/layout.ts (pure), lib/photoLibrary.ts, lib/settingsStore.ts (M)
- exporter.ts: move isTransparentBg out of store (lib must not import the app store) (S)
- lib/motionTokens.ts for the shared ease curve hardcoded in dockSwap/dockFlip/boardPager (S)
- paneCommands.ts: one file one job (S)

## Wave 3: content features (read-only on the exporter)

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
