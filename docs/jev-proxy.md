# Jev label icon proxy

Production builds never carry the TypeSafe key. When `VITE_JEV_API_URL` is
unset, a production build points the label icon pick at the same-origin Worker
route `POST /api/jev`. The Worker forwards the JSON body unchanged to
`JEV_API_URL` with `Authorization: Bearer <JEV_API_KEY>`, then returns the
upstream status, content type and body. The client cannot choose the upstream.

The Worker accepts only POST, caps the body at 64 KiB, and gives the upstream
20 seconds before it answers 504. Without both secrets the route answers 503.

## When the pick runs

`commitEdit` in `src/components/BoardLabel.tsx` saves the label text and calls
`requestLabelIcon`. The call is fire-and-forget, so it never blocks or reverts
the edit.

The pick starts only when the label exists, has no icon, and carries non-empty
text. When the answer arrives, the label must still exist, still have no icon,
and still carry the exact text that was sent. Anything else drops the answer.
A timeout, an offline network, a 503, a malformed body, or an unknown icon id
leaves the label text-only and shows no error. There is no retry.

An icon the user chose wins. The label's icon picker sets `icon` directly, and
the resolve guard skips a label that has one.

## The upstream contract

The endpoint is `POST https://api.typesafe.ai/v1/systemone`. The request is
`application/json` with one Choice question:

```json
{
  "model": "jev-latest",
  "state": "生日蛋糕",
  "questions": {
    "label_icon": {
      "type": "choice",
      "instructions": "Pick the one leading icon that best fits the label text. Choose \"none\" when no icon fits. The label text may be in any language.",
      "criteria": {
        "cake": "Cake",
        "plane": "Plane",
        "none": "No icon fits; leave the label as text only."
      }
    }
  }
}
```

`state` is the committed label text. The criteria are every entry in
`LABEL_ICONS` from `src/lib/labelIcons.ts`, keyed by the stored icon id and
described by the icon's English label text. The catalog holds 128 icons, so a
request carries 129 options including `none`, under the API's 255 option limit.
No candidate is dropped.

The answer names one option and its confidence:

```json
{
  "model": "jev-1.14.0",
  "answers": {
    "label_icon": {
      "type": "choice",
      "choice": "cake",
      "confidence": 0.96
    }
  }
}
```

`choice` is an icon id or `none`. `src/lib/jev.ts` accepts only a catalog id, a
valid confidence, and a well-formed answer; anything else is a shape failure.
An unknown id never lands on a label.

Confidence does not gate the pick. It measures how concentrated the answer is,
not whether the choice is safe, and a leading icon is a harmless preference
that the user can change. A low-confidence answer applies like any other.

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
curl -X POST http://127.0.0.1:8787/api/jev \
  -H 'content-type: application/json' \
  --data @request.json
```

Without both secrets the route answers 503. A direct request from this machine
is answered 451, so a local run points `JEV_API_URL` at `scripts/jev-mock.mjs`
in a gitignored `.dev.vars`. The deployed Worker reaches the real endpoint.

```ini
JEV_API_URL=http://127.0.0.1:4319/v1/systemone
JEV_API_KEY=mock
```

## Client overrides

The browser check sets `VITE_JEV_API_URL` explicitly, and that value wins over
the proxy fallback. A dev run must set it too; `.env.local` carries only the key.
`VITE_JEV_API_KEY` is read in dev only, so a direct mock can assert on it. A
production build never reads it.
