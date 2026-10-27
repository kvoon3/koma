# How to run koma on Void

Void owns the deploy pipeline and the server code. `void.config.ts` is the
single source of truth for the Cloudflare config, `routes/` holds the server
handlers, and `env.ts` declares the server values. There is no root
`wrangler.jsonc`; the old one lives in git history and in
`.void/config-migration/` if you ever need to compare.

## Deploy

Run `bun run deploy`. It is `void deploy`, which runs the repo's own build
(`bun run check-types && vite build`), uploads the worker with the `routes/`
handlers, and activates it on `koma.kvoon.me`.

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

## Recover a bad deploy

List versions and roll back:

```sh
bunx void project status
printf 'y\n' | script -q /dev/null bunx void project rollback <deployId> --platform cloudflare
```

The `printf` answers the confirmation prompt; the CLI refuses to run it
without a terminal. If `void` itself is wedged, the worker is still a normal
Cloudflare worker: `void connect` regenerates `.void-wrangler.jsonc`, and
`wrangler deploy --config .void-wrangler.jsonc` deploys it without void.

Two errors you may hit on the way:

- "dashboard-managed routes or visibility" means a dashboard setting is not
  declared in `void.config.ts`. Read the current value from the worker and
  declare it. `workers_dev: false` is already declared for this reason.
- "the active Worker Version is not the latest upload" appears after a
  rollback: a newer uploaded version still exists. Activate or delete the
  newer version in Cloudflare, or deploy through the wrangler fallback, which
  makes the active version the latest again.

## Gotchas

- Never reintroduce `cloudflare.main` or `cloudflare.assets` in
  `void.config.ts`. `void deploy` silently builds a "Static SPA" from that
  shape and drops the worker, which takes `/api/jev` down. This happened
  twice on production before the routes/ move; both times the probes above
  caught it inside a minute.
- Never check in a root `wrangler*.jsonc`. Void refuses to connect or deploy
  while one exists. The storybook worker keeps its own
  `wrangler.storybook.jsonc`, which is fine because it is not at the root.
- `GET /api/jev` now returns the SPA shell with `200`, not the old `405`.
  Nothing consumes that path with GET; the POST contract is unchanged.
- The old config's `run_worker_first` does not exist in the native shape.
  Whether asset hits still skip the worker invocation is unverified; measure
  with `void project logs` before relying on it.
- Branch preview URLs (`<branch-slug>-koma.kvoon.workers.dev`) predate the
  Void switch and their minting mechanism is unconfirmed. Verify before
  promising one in a PR.
