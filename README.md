# koma

「コマ」— a frame of film, a panel of a comic.

A collage tool built on **pane splitting**, like tmux: start with a single pane,
split right / split down to grow the layout, drag dividers to resize, and drop
photos into panes where they can be panned, zoomed and cropped. What falls
outside a pane is cropped away — arranging panes is the whole editor.

**→ [koma.kvoon.me](https://koma.kvoon.me)**

Photos never leave your machine; nothing is uploaded. JPEG / PNG / WebP / HEIC
(iPhone default, decoded in-browser) and Live Photos: press and hold a pane to
play the live moment — export always uses the still frame. Works offline.

## Develop

```bash
bun install
bun dev
bun run build
bun run lint
```

Requires [mise](https://mise.jdx.dev) (provides Bun) — `mise.toml` pins `bun = 1`.

Design notes — pane tree model, interaction reference, implementation details —
live in [DESIGN.md](DESIGN.md).
