# App shell: routing, session, WeChat, the launcher, styling

Why-notes for the parts that wrap the board. Code and tests own what the
behavior is (`lib/routes.ts`, `lib/sessionStore.ts`, `lib/browser.ts`,
`index.css`); these notes hold what the code cannot say.

## Routing and persistence

- **Hash history** (TanStack Router, code-based): `/` is the 3×3 overview,
  `/w/$wsId` the editor, `/library` the unified library (`/photos` and
  `/stickers` redirect to its tabs). Hash history exists because the
  single-file build (`bun run build:single` → `koma.html`) must work opened
  directly via `file://`.
- **The route is the view.** The view no longer lives in the store: the route
  param drives `activeId`. Grid↔edit navigations pass `viewTransition` so the
  cell→canvas morph keeps working (disabled under `prefers-reduced-motion`).
- **The library is a page, not a drawer**: it draws its own chrome (no
  floating board actions, the board's key map inert there), and its back chip
  returns wherever it was opened from. The board's drawer stays photo-only.
- **The session autosaves** (workspace trees, settings, and the photo library
  with real `File` objects via IndexedDB structured clone) to the
  `koma-session` database, debounced 800ms with a flush on page hide. Boot
  hydrates from it before the first render, so a refresh lands exactly where
  you left off; photos whose header probe never finished are re-probed on
  hydrate. `clearLibrary` wipes the database too.
- **The workspace file** exports the entire board + library as
  `koma-<date>.koma.json` (photos embedded as data URLs, Live Photo MOVs
  included, ids preserved); opening one replaces the current board after a
  confirm. Originals inflate ~33% as base64; the upgrade path is an fflate
  zip container.

## WeChat's built-in browser

WeChat identifies its WebView with `MicroMessenger/<version>` in the UA on
every platform, which is what `lib/browser.ts` reads, and it takes away
exactly what a photo editor needs: an export lands in WeChat's own viewer
instead of the album, and its picker re-encodes the photos it hands over. The
guard asks once per tab session on boot; staying is remembered in
`sessionStorage` (`collage:wechatStayed`), so a reload does not re-ask and a
new session does.

Leaving has no API. iOS refuses every custom scheme and Android's XWeb kernel
swallows `intent://` in most builds, so asking the system for a VIEW intent
is a best effort the guard makes on Android and ignores elsewhere; the real
path is a picture of WeChat's menu. The card is bottom-anchored like the
drawers rather than centered: on a phone that is where the thumb is, and it
keeps the marker at the top and the answer at the bottom of the screen. The
small print states what changes: photos imported here live in this browser's
storage, so the system browser starts with an empty library.

## The retained launcher (`#/legacy-index`)

A launcher that puts the three surfaces side by side (the board overview, the
library's photos tab, its stickers tab) was drafted while the app's root was
under review. The root went back to the 3×3 overview, and the page is kept
routable and fully working, linked from nowhere: not in any menu, no card
points at it, no shortcut reaches it. `isHubPath` keeps the board chrome
inert there, as on the library page; `lib/hubSeen` records per-destination
"last opened" timestamps for its cards. Its cards follow the workspace
switcher's card idiom rather than inventing a launcher style.

## Styling

Tailwind v4 (via `@tailwindcss/vite`) with a token-only color system. Raw
palette values live on `:root` / `html.dark` in `src/index.css`; `@theme
inline` maps them to semantic tokens (`bg-panel`, `text-dim`, `border-line`,
`bg-accent`, …) so `.dark` re-themes every utility at runtime. Never reach
for `dark:` variants for chrome colors.

The theme toggle swaps `.dark` inside a view transition (`fadeTheme`), so
light ⇄ dark crossfades in 250ms instead of cutting; the OS-driven change
stays instant. A committed pane swap runs inside a view transition the same
way (`runSwapTransition` in `components/Pane.tsx`), naming the photo's
clipping wrapper on both panes so the two crops glide across. The named
element has to be the clip (`[data-photo-clip]`, pane-sized, `overflow:
hidden`), never the `img`: the API snapshots an element at its own box, so
naming the img snapshots the whole image and the morph spills past the pane
over its neighbours.

`field.tsx` holds the one labelled-control row, the range slider, the select
and the color input, so the settings drawer and the sticker maker cannot
drift apart. `@shadcn/lint` enforces the token rule (`shadcn/no-raw-colors`,
`shadcn/no-unknown-classes`, `shadcn/no-restyle`); the multi-layer stage and
swatch checkerboards, and labels/swatches using literal white or black
(export fidelity and gap-fill picks), are the documented exceptions.

## Component workshop

Storybook hosts the presentational components outside the app. It imports the
real `src/index.css` and boots the real theme and language stores: both are
module stores with no React context, so `.storybook/preview.tsx` drives them
from the toolbar globals. A story renders the shipped themes and translations,
not a stand-in canvas.

`.storybook/main.ts` reuses the app's Vite plugin list through `viteFinal`,
dropping only the three dev-only plugins (`vite:plugin:mkcert`,
`vite-plugin-qrcode`, `koma:vendor-runtime`): the workshop serves plain HTTP
and carries no transformers runtime. One plugin source keeps the workshop from
drifting off the app's build.

The preview is a CSF4 factory (`definePreview`), which composes only what it
is handed. The docs renderer from `@storybook/addon-docs` joins through the
factory's `addons` array; the `addons` list in `main.ts` covers the manager
side only. Docs pages generate from each meta's `autodocs` tag and the
component's JSDoc.

The workshop deploys separately (`bun run deploy:storybook`, config
`wrangler.storybook.jsonc`) to the `koma-storybook` Worker, so `dist/` stays
story-free and a workshop deploy never ships the app.
