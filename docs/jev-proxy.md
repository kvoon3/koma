# Jev classification proxy

Production builds never carry the Jev key. When `VITE_JEV_API_URL` is unset, a
production build points the Classify action at the same-origin Worker route
`POST /api/jev`. The Worker forwards the multipart body to the secret
`JEV_API_URL` with `Authorization: Bearer <JEV_API_KEY>`, then returns the
upstream status, content type and body. The client cannot choose the upstream.

The route accepts POST only, caps the body at 15 MB, and times the upstream out
at 20 seconds. A missing URL or key answers 503 with
`{ "error": "unconfigured" }`, which is the state until the operator supplies
the real endpoint.

## Deploy the secrets

Set both on the Worker. Never put the key in a `VITE_` variable that a build can
inline.

```bash
npx wrangler secret put JEV_API_URL
npx wrangler secret put JEV_API_KEY
```

## Test the proxy locally

```bash
bun run build
npx wrangler dev
curl -X POST http://127.0.0.1:8787/api/jev -F image=@photo.jpg
```

Without both secrets the route answers 503. To reach a real upstream locally,
add them to a gitignored `.dev.vars` and restart `wrangler dev`.

## Client overrides

Local dev and the browser check set `VITE_JEV_API_URL` explicitly to a mock, and
that value still wins over the proxy fallback. `VITE_JEV_API_KEY` is read in dev
only, so a direct mock can assert on it. A production build ignores it.
