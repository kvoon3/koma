# koma

「コマ」

A collage tool built on **pane splitting**, like tmux: start with a single pane,
split right / split down to grow the layout, drag dividers to resize, and drop
photos into panes where they can be panned, zoomed and cropped. What falls
outside a pane is cropped away — arranging panes is the whole editor.

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
