# koma roadmap

Items are grouped into **waves by change surface** (which files they touch), so each wave runs as 2–3 parallel worktrees without cherry-pick conflicts. Within a wave everything is parallel. Between waves we merge, verify (`bun run ci`), then start the next wave.

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

## Wave 2 (PRs #29, #30, #31)

- Detent rotation for pane photos: reusable dial, stepless drag with detent magnetism, flips, undo-coalesced gestures
- Tools-drawer rework: three displays with live mode-switching mid-drag, FLIP item glides, whole-drawer drag, scroll preservation, list-swap slide, edge fade
- Workspaces: Mission Control-style switcher (pull-down in, pull-up out, 1:1 board pager, read-only strip, nameless cards), grid groups with copy-on-add, WorkspaceGrid split into components/grid/
- Vision acceptance pipeline (judge at 375px + 1280px) recorded in AGENTS.md; i18n drift test; UNDOABLE_PATCH_KEYS derived from the snapshot

## Tech debt (PRs #32, #33, #34)

- router.tsx export flow + key map extracted (687 → 274 lines)
- store.ts split along its seams (1480 → 1211; layout/photoLibrary/settingsStore in lib/)
- exporter decoupled from the store; motionTokens single source; paneCommands one job
- Follow-up (M): the four store-reading command modules; action factories to shrink store.ts further

## Wave 3 (PRs #35 to #39)

- Tactile texture filters for pane photos
- Multi-line labels with alignment, and EXIF location pins
- Tapping the receded board leaves the switcher
- Die-cut sticker border, stamp perforation, manual cutout adjustment
- Dock scroll jitter fix

## Wave 3.5 (PRs #40 to #44)

- Pixelation filter family (six, stage-px WYSIWYG dials)
- Sticker management (#/stickers) with folders, usage badges, make-on-page
- Sticker erase and re-edit back to the ORIGINAL (original+result pair)
- Photo management (#/photos) with tags, EXIF detail and reverse geocoding, safe delete; the hub draft parked at #/legacy-index
- History: step tree with a jump panel in the floating cluster; pure-overwrite rule (one chain)

## Wave 4 (PRs #46, #47, #48, plus #45)

- Pane minimap (photo pan navigator) and whole-canvas view zoom from the stage margin (0.25–2.5, % chip, double-click fit); the +/- pair removed
- Cutout tool as a live three-state menu (original / cutout / blurred background), switchable anytime from library assets
- Glowing pure-white label: an independent effect (theme forced transparent) with continuous falloff
- PR #45: one CI runner per gate, and `bun check` for types

## Wave 5 (PRs #49, #51)

- Japanese as a third interface language
- Translation keys typed against the zh-Hans universe

## Waves 6 to 10 (PRs #50, #52 to #55)

- Spotify-style square cards, cover and lyrics presets (#50, #53)
- One library page for photos and stickers (#52)
- The stage's right-edge size rail (#54)
- Filter test time budget (#55)

## Chore (PR #56)

- New worktrees install their dependencies on checkout

## Wave 11 and 12

Merged on 2026-10-24, and the merge deployed main.

- PR #57: compact minimap chip seated against the tools dock's top-left corner, outside the pane
- PR #58: the size rail resizes the canvas when nothing is selected, focused or not
- PR #59: Storybook workshop for eight presentational components, with a separate `koma-storybook` project still to be created
- PR #60: Jev picks a text label's leading icon from the 128-entry icon set when its text is committed, through a Worker proxy that holds the key
- PR #61: newspaper-print texture, fixed with no strength control, and camera capture in the sticker maker

## Remaining

- **tldraw integration** (feasibility spike first).
- **Map route cards** (reuses `exif.ts`): spike on the map rendering choice.
- **UI transparency pass** (`theme.ts`, `buttonStyles.ts`).
- **Website** side track: landing page and video, roadmap board fed from this file, release notes, feedback.
- **Accounts + cloud sync / void deployment**: one design decision, not a coding task. Run a feasibility comparison (void vs the current Cloudflare deploy, backend shape for sync and sharing) and decide before scheduling implementation.
- **Brand open items**: README header lockup, social avatar and Open Graph card, opt-in export watermark, OS light/dark app-icon pair, optional shu seal variant, brand page on the website track.
- **Safari export seam root cause**.

## Waiting on the operator

- Rotate the Jev key, which was shared in chat. It lives in one place, the `koma-secrets` Secrets Store secret `JEV_API_KEY` (rotate with `wrangler secrets-store secret update a899316ec4254513b2f9e7572f58996a --name JEV_API_KEY --remote`); the `koma` Worker binds it from `wrangler.jsonc`, so deploys no longer lose it. The stale Worker-secret and preview-base-config copies go away with the next deploy and can be deleted from the dashboard.
- A direct request from this machine still gets HTTP 451, so local runs need an egress outside the blocked region; `docs/jev-proxy.md` covers seeding a local store copy for `wrangler dev`.
- `koma-storybook` is deployed at `https://koma-storybook.kvoon.workers.dev` (manual `bun run deploy:storybook`). A second Workers Builds project pointed at `main` would make it automatic.

## Rules of engagement

- 2 to 3 code agents per wave, one worktree each, a fresh agent per item. The parent reviews every diff.
- Anything touching `exporter.ts` is serialized across waves.
- Locale work lands when UI strings are stable, and every new key goes into all three dictionaries.
- A lane gets its own worktree. Never run two lanes in the main checkout.
- Branches are `waveN/<layer>`, stacked with `gh pr create --base` when one depends on another.
- Local `bun run ci` is the feedback loop. Push when a lane is review-ready. Cloudflare deploys main on merge.
