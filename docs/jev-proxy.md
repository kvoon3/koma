# Jev classification proxy

Production builds never carry the TypeSafe key. When `VITE_JEV_API_URL` is
unset, a production build points the Classify action at the same-origin Worker
route `POST /api/jev`. The Worker forwards the multipart body to `JEV_API_URL`
with `Authorization: Bearer <JEV_API_KEY>` and
`TypeSafe-Danger-Zone-Images: true`, then returns the upstream status, content
type and body. The client cannot choose the upstream.

## The upstream contract

The endpoint is `POST https://api.typesafe.ai/v1/systemone`. The first multipart
part is `request`, a JSON document with content type `application/json`. It
names the model `jev-latest`, points the `photo` state at the `photo` asset part,
and asks one Noul question per tag category. The image travels as its own
`photo` part, as PNG or JPEG with each side from 280 to 1568 pixels.

`src/lib/jevTaxonomy.ts` owns the categories. Each category has an id, a display
label, an instruction, and true and false criteria. The ids and labels follow
`src/lib/tagIcons.ts`, so one set drives the icons and the questions. The model
never chooses the displayed label.

A Noul answer is a probability from 0 to 1. The client keeps answers at or above
`JEV_NOUL_THRESHOLD`, which is 0.7, sorts them from highest to lowest, and caps
the result at eight labels. A well-formed answer with nothing above the
threshold is the `empty` failure.

## The image

The client draws the preview onto a canvas sized by `jevImageBox`. The long edge
is at most 1024 pixels and the short edge is at least 280. A wide or tall source
is letterboxed rather than upscaled past the 1568 pixel side limit. The canvas is
filled with neutral gray and exported as JPEG at quality 0.9.

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
curl -X POST http://127.0.0.1:8787/api/jev -F request=@request.json -F photo=@photo.jpg
```

Without both secrets the route answers 503. To reach the real upstream locally,
add them to a gitignored `.dev.vars` and restart `wrangler dev`.

```ini
JEV_API_URL=https://api.typesafe.ai/v1/systemone
JEV_API_KEY=<your key>
```

## Client overrides

Local dev and the browser check set `VITE_JEV_API_URL` explicitly, and that value
wins over the proxy fallback. `VITE_JEV_API_KEY` is read in dev only, so a direct
mock can assert on it. A production build ignores it.
