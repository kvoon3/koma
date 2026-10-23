# koma

「コマ」

A collage tool built on **pane splitting**, like tmux: start with a single pane,
split right / split down to grow the layout, drag dividers to resize, and drop
photos into panes where they can be panned, zoomed and cropped. What falls
outside a pane is cropped away; arranging panes is the whole editor.

## Develop

```bash
bun install
bun dev
bun run build     # bun check, then vite build
bun run lint
bun test          # type-checked first, then the suite
```

Requires [mise](https://mise.jdx.dev) (provides Bun); `mise.toml` pins
`bun = 1.4.3`. Type checking is Bun's own `bun check` (a port of
`typescript-go`, needs 1.4.3 or newer), not `tsc`; TypeScript stays installed
only for the editor and typescript-eslint.

Design notes: pane tree model, interaction reference, implementation details
live in [DESIGN.md](DESIGN.md).

Jev classification posts to a Worker proxy in production. The two secrets and
the local check live in [docs/jev-proxy.md](docs/jev-proxy.md).

## License

[MIT](LICENSE) © Kevin Kwong. Third-party notices live in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
