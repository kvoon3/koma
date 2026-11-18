# How to run koma on Void

Void owns the deploy pipeline and the server code. `void.config.ts` is the
single source of truth for the Cloudflare config, `routes/` holds the server
handlers, and `env.ts` declares the server values. There is no root
`wrangler.jsonc`; the old one lives in git history and in
`.void/config-migration/` if you ever need to compare.

## Deploy

`.github/workflows/void-deploy.yml` runs on every push to main (and on
demand): it builds the void shape with `bun run build:void`, then runs
`wrangler deploy --config dist/ssr/wrangler.json`. That generated config is
the deployable artifact: the Worker entry (`main`), the `ASSETS` binding, the
`koma` name, the account and the `koma.kvoon.me` route. Wrangler consumes
`CLOUDFLARE_API_TOKEN` directly and deploys with `keepSecrets: true`, so a CI
deploy inherits the Worker's `JEV_API_URL` / `JEV_API_KEY` secrets.

The workflow deliberately does not call `void deploy`. void 1.3.0's
version-aware uploader borrows its bearer from wrangler's `auth.token`, and on
a headless GitHub runner that borrow returns nothing, so the upload fails with
`Cloudflare session has no bearer for version-aware upload`
(voidzero-dev/void#627). An earlier CI-shaped void deploy also lost the Worker
secrets during its trigger-sync recovery; see Gotchas.

`bun run deploy` is the manual path for a logged-in machine. It is
`void deploy`, which runs the same build step named in `inference.build`
(the repo's `bun run build:void`,
typecheck included, whose output lands in `dist/client` + `dist/ssr`),
uploads the worker with the `routes/` handlers, and activates it on
`koma.kvoon.me`. The plain
`bun run build` stays client-shaped (a root `dist/index.html`) because the
mygo desktop shell and `scripts/jev-e2e.mjs` consume that layout; only the
`--mode void` build runs `voidPlugin()`.

### Watch a deploy

- Auto path: the repo's GitHub Actions tab, workflow "Deploy to Cloudflare"
  (one run per push to main). The same status rides each commit as the
  "Deploy to Cloudflare" check. Green means the worker activated; red means
  traffic is unchanged.
- Manual path: the `bun run deploy` output in your terminal.
- Source of truth for what is live: Cloudflare dashboard → Workers & Pages →
  koma → Deployments (version list and live percentage; CI deploys carry no
  `void:{...}` metadata). CLI equivalents: `npx wrangler deployments list
  --name koma`, `bunx void project status`.
- Whichever path ran, finish with the four probes below; a green banner is
  not evidence.

Trust four probes after any deploy, not the success banner:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://koma.kvoon.me/            # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://koma.kvoon.me/library     # 200, SPA fallback
curl -sS -o /dev/null -w '%{http_code}\n' https://koma.kvoon.me/vendor/transformers.min.js  # 200
curl -sS -X POST -H 'content-type: application/json' -d '{}' -o /dev/null -w '%{http_code}\n' https://koma.kvoon.me/api/jev
```

The last probe returns a 4xx from the Jev upstream when the whole chain
works: the route, both secrets, and the upstream. A `503 unconfigured` means
a secret is missing. A `200` with an HTML body means the asset fallback
swallowed the route and the deploy dropped the worker.

## Set or rotate a server value

The proxy's values are `JEV_API_URL` and `JEV_API_KEY`, declared optional in
`env.ts` so an unconfigured worker answers `503` instead of failing startup.
Set them remotely:

```sh
bunx void secret put JEV_API_URL
bunx void secret put JEV_API_KEY
```

The dashboard secrets that predate the Void switch carry over. Do not define
the same names as plaintext `vars` in `void.config.ts`; schema-declared
server values must be secrets.

For local development, put values in a root `.env` file. `.dev.vars` is not
supported.

## D1, auth, and migrations

Auth (Better Auth through void) and the app's tables live in one D1 database
behind the `DB` binding. Void infers the binding from the `void/auth` /
`void/db` imports; the `d1_databases` entry in `void.config.ts` pins only
`migrations_dir: './db/migrations'`, which void rebases into the generated
`dist/ssr/wrangler.json` as `../../db/migrations`. Without that entry the
generated config points at `<repo>/migrations`, and the deploy's migration
step fails with "No migrations present".

### Local database

```sh
bunx void db status    # migrations applied or pending locally
bunx void db generate  # write SQL under db/migrations/ (review, then commit)
bunx void db migrate   # apply pending migrations to the local database
bunx void db seed      # reset the local database and run a seed file
```

The dev server shares that database. Changing `db/schema.ts` or the auth
config means: `void db generate`, review the SQL, commit it, `void db
migrate`, restart the dev server.

### Cloud projects API

A missing or foreign project id must answer JSON, never the SPA's HTML. After
the first deploy that carries the `projects` table, check the content type:

```sh
curl -sS -o /dev/null -w '%{content_type} %{http_code}' \
  https://koma.kvoon.me/api/projects/00000000-0000-0000-0000-000000000000
```

With a signed-in session cookie it must answer `application/json 404`.
Without a session the auth layer answers `401`, never `text/html`. The client
sends `Accept: application/json`, so local dev and production agree.

### Production (operator)

The GitHub Actions deploy runs `wrangler deploy` directly, so void's
deploy-time provisioning and migration apply do not fire. The workflow
applies the pending migrations itself with
`bunx wrangler d1 migrations apply DB --config dist/ssr/wrangler.json
--remote` before the deploy step, using the `migrations_dir` the config
pins. Two operator steps are still manual, once, from a logged-in machine:

1. Provision the production D1 database, then record its id so CI emits a
   deployable binding. Either path works:
   `bunx void deploy --platform cloudflare --provision` (void provisions the
   database and writes the resolved id into `void.lock.json`), or
   `bunx wrangler d1 create koma`.
   In both cases, add that id to the entry in `void.config.ts`:
   `{ binding: 'DB', database_name: 'default', database_id: '<id>', migrations_dir: './db/migrations' }`,
   and commit `void.config.ts` with `void.lock.json`. CI builds from the
   committed tree, so the generated config carries the id only after that
   commit. Verify with `bunx void db status`, which prints the remote target.
2. Set the auth secret: `bunx void secret put BETTER_AUTH_SECRET` (void
   preserves it on later deploys) or, against the worker directly,
   `bunx wrangler secret put BETTER_AUTH_SECRET --config dist/ssr/wrangler.json`.
   Deploys through GitHub Actions never auto-create it, because the wrangler
   path bypasses void's deploy checks.

Before merging, prove the step locally with the same command CI runs, minus
the remote flag and the id:
`bunx wrangler d1 migrations list DB --config dist/ssr/wrangler.json --local`
It must list the migration instead of "No migrations present".

The first production deploy runs the workflow's migration step; watch its
log line "Apply D1 migrations" for the applied count. A rollback does not
reverse migrations; `void db restore --bookmark <printed-by-deploy>` undoes
them within 7 days on Workers Free (30 on Workers Paid), and only the void
deploy path prints a bookmark. After a CI wrangler deploy, a migration
rollback is manual: write a reversing migration instead.

## R2 asset bucket

Uploaded library photos live in R2 behind the `STORAGE` binding; the `assets`
table holds their metadata and the key `assets/{userId}/{assetId}` (derived in
`src/lib/assetKeys.ts`). The bucket is declared in `void.config.ts` under
`cloudflare.r2_buckets`. A Live Photo uploads twice: the still under its photo
id, and its motion file under `{photoId}~motion`. The still's `meta`
carries a `motionAssetId` pointer, so a second device restores press-and-hold
playback with the still.

The upload's JSON head is capped at 2 MB. A sticker maker record larger than
that is rejected and the whole save fails with the generic upload error, not a
per-photo skip. `ORIGINAL_MAX` (1600 px) keeps normal records well under the
cap; if a recipe approaches it, split the recipe or lower the original size.

Local development needs no bucket and no login: void's dev server runs
Miniflare's file-backed R2 under `.void/v3/r2`, and the upload and serve routes
work against it. Clearing `.void/v3/r2` deletes the local objects; the
`assets` rows in local D1 outlive that, so a GET then answers 404.

### Production (operator, once)

```sh
bunx wrangler r2 bucket create koma-assets
bunx wrangler r2 bucket list   # shows koma-assets
```

`void deploy --platform cloudflare --provision` also creates the bucket from
the config. The bucket needs no custom domain and no public access: the serve
route reads it with the Worker's binding and answers behind `requireAuth`.
Never make the bucket public, and never create it from CI.

The first deploy after that succeeds proves the binding end to end: sign in,
save a session with a photo, then open the served URL with the session cookie.
A missing binding fails the upload route, not the editor.

The per-PR preview Worker (`koma-pr-<n>`) gets its own bindings from the
preview workflow. Check one preview's upload after the first PR that carries
this route; if the binding is absent there, previews can still load the
editor but cannot store assets. That is an operator check, not a gate on this
PR.

## Run the server code locally

`voidPlugin()` in `vite.config.ts` runs the dev server on Cloudflare's
runtime, so `routes/` handlers execute in `workerd` during
`bun run dev`. It coexists with the mkcert https server, the LAN QR code,
and the `/vendor/` wasm middleware. With no `.env`, a local `POST /api/jev`
answers `503 unconfigured`.

The proxy logic is pure code in `routes/_jev.ts` (the leading underscore
keeps the router from serving it). `routes/_jev.test.ts` drives it directly;
run the suite with `bun test --isolate routes/_jev.test.ts`.

One void 1.3.0 defect needs a local guard: void rewrites index.html's inline
module scripts (the react-refresh preamble) into build-style `?html-proxy`
ids and emits a script tag for a module that does not exist in dev. The
request 500s and vite's error overlay covers the app. The
`koma:strip-void-dev-proxy` plugin in `vite.config.ts` removes that duplicate
tag in dev only. Drop the plugin once a void release stops emitting it; the
preamble itself stays inline either way.

## Recover a bad deploy

List versions and roll back:

```sh
bunx void project status
printf 'y\n' | script -q /dev/null bunx void project rollback <deployId> --platform cloudflare
```

The `printf` answers the confirmation prompt; the CLI refuses to run it
without a terminal. CI deploys are wrangler deploys and carry no `void:{...}`
metadata, so `void project status` lists them without attribution:
`npx wrangler deployments list --name koma` reads them, and
`npx wrangler rollback <version-id> --config dist/ssr/wrangler.json` rolls one
back. Only the generated `dist/ssr/wrangler.json` is wrangler-deployable; the
root `.void-wrangler.jsonc` carries no `main` or `assets`. If `void` itself
is broken, check out a pre-void tree from git history (any commit before
`build(void): adopt the void config and CLI`) and run its own
`bun run build && wrangler deploy`; that pipeline is self-contained and
deploys the old proxy worker with the SPA.

Two errors you may hit on the way:

- "dashboard-managed routes or visibility" means a dashboard setting is not
  declared in `void.config.ts`. Read the current value from the worker and
  declare it. `workers_dev: false` is already declared for this reason.
- "the active Worker Version is not the latest upload" appears after a
  rollback: a newer uploaded version still exists. Deploy again with
  `bun run deploy`; the new upload becomes the latest and is activated, which
  clears the check.

## PR previews

`.github/workflows/preview.yml` deploys every push to a pull request as its
own static Worker, `koma-pr-<number>` at
`https://koma-pr-<number>.kvoon.workers.dev`, and updates one sticky comment
on the PR with that URL and the commit. Closing the PR deletes the Worker.

The config is `wrangler.preview.jsonc`, an assets-only Worker over `dist/`.
It never touches `koma`, its domain, or its secrets. The client build is the
real bundle, but `routes/` is not deployed, so `/api/jev` answers 404 there.
Fork PRs are skipped because Actions does not expose the secret to them.

`.github/workflows/storybook-preview.yml` does the same for the workshop,
deploying `koma-storybook-pr-<number>` at
`https://koma-storybook-pr-<number>.kvoon.workers.dev`. It builds the workshop
from `wrangler.storybook.jsonc` and never touches `koma-storybook`.

The deploy uses the `CLOUDFLARE_API_TOKEN` secret, which needs Workers Scripts
edit for the account. A manual deploy of the same shape:

```sh
bun run build
bunx wrangler deploy --config wrangler.preview.jsonc --name koma-pr-<number>
bun run build-storybook
bunx wrangler deploy --config wrangler.storybook.jsonc --name koma-storybook-pr-<number>
```

## Gotchas

- Never reintroduce `cloudflare.main` or `cloudflare.assets` in
  `void.config.ts`. `void deploy` silently builds a "Static SPA" from that
  shape and drops the worker, which takes `/api/jev` down. This happened
  twice on production before the routes/ move: the first ran ~150 s before
  the rollback, the retry ~56 s. The probes above caught both.
- Never check in a root `wrangler.jsonc` or `wrangler.json`. Void refuses to
  connect or deploy while either exists at the repo root (it checks those two
  exact names, not a glob). The storybook worker's
  `wrangler.storybook.jsonc` also sits at the root but its name never
  matches, so void ignores it.
- `GET /api/jev` now returns the SPA shell with `200`, not the old `405`.
  Nothing consumes that path with GET; the POST contract is unchanged.
- The native shape broadens the worker's route surface to `/api`,
  `/api/*`, `/__void` and `/__void/*`. `GET /__void/ready` answers `200`
  publicly on production (measured 2026-10-27); it is void's readiness
  endpoint, not ours to shape.
- The native emission carries `run_worker_first` after all, set to `/api`,
  `/api/*`, `/__void`, `/__void/*` in the generated `dist/ssr/wrangler.json`:
  the worker runs ahead of assets on exactly the API surface. What stays
  unmeasured is the cost and resilience of that invocation on asset-heavy
  pages; measure with `void project logs` before relying on it.
- The Cloudflare Workers Builds integration ("Workers Builds: koma", a PR
  check) is disconnected. Do not reconnect it. When it ran, its bare
  `wrangler deploy` on every `main` merge replaced the app Worker and wiped
  its secrets. The app's push-to-main deploys now go through
  `.github/workflows/void-deploy.yml`. Before the disconnect, #80, #81 and
  #77 merged between 05:31 and 05:53Z on 2026-10-27. The integration deployed
  40 to 60 seconds after each merge, without metadata, so
  `wrangler deployments list` could not attribute those versions to the void
  pipeline.
- Branch preview URLs were unverified after the Void switch. PR previews now
  have their own Worker per PR (`koma-pr-<number>.kvoon.workers.dev`), owned
  by `.github/workflows/preview.yml`; see PR previews.
