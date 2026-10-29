# How to run koma on Void

Void owns the deploy pipeline and the server code. `void.config.ts` is the
single source of truth for the Cloudflare config, `routes/` holds the server
handlers, and `env.ts` declares the server values. There is no root
`wrangler.jsonc`; the old one lives in git history and in
`.void/config-migration/` if you ever need to compare.

## Deploy

The auto path is quarantined. `.github/workflows/void-deploy.yml` (void's
Actions template) ran once on 2026-10-27 and its trigger synchronization
failed; the recovery left an empty, binding-less version active, which
wiped both worker secrets and broke the routes until a local deploy
repaired them (see Gotchas). void's upload patch also sets `keep_vars`
but never `keep_secrets` (deploy-hRPvw8ci.mjs in its dist), so treat every
CI-shaped deploy as secret-hostile until void fixes this. Keep the
workflow disabled and deploy by hand:

`bun run deploy` is the manual path. It is `void deploy`, which runs the
build step named in `inference.build` (the repo's `bun run build:void`,
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
  koma → Deployments (version list, live percentage, `void:{...}` metadata).
  The dashboard's Builds section is gone with the disconnected integration.
  CLI equivalents: `npx wrangler deployments list --config
  .void-wrangler.jsonc`, `bunx void project status`.
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
without a terminal. There is no wrangler fallback for the native shape: the
generated `.void-wrangler.jsonc` carries no `main` or `assets`, and no
wrangler-deployable worker entry exists outside void's build. If `void` itself
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

The deploy uses the `CLOUDFLARE_API_TOKEN` secret, which needs Workers Scripts
edit for the account. A manual deploy of the same shape:

```sh
bun run build
bunx wrangler deploy --config wrangler.preview.jsonc --name koma-pr-<number>
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
  check) has been auto-deploying every `main` merge 40–60 s later with a bare
  `wrangler deploy` from the in-tree `wrangler.jsonc` (measured: #80, #81 and
  #77 merged 05:31–05:53Z on 2026-10-27, each followed by a metadata-less
  deploy; the live bundle carried #80's minimap marker). Those deploys carry
  no `void:{...}` metadata, so `wrangler deployments list` cannot attribute
  them to the void pipeline. Once the root `wrangler.jsonc` is gone from
  main (this stack), the integration's build fails permanently and manual
  `bun run deploy` becomes the only deploy path. Either accept that or
  reconnect the integration with `bun run deploy` as its build command; do
  not let both pipelines run.
- Branch preview URLs were unverified after the Void switch. PR previews now
  have their own Worker per PR (`koma-pr-<number>.kvoon.workers.dev`), owned
  by `.github/workflows/preview.yml`; see PR previews.
