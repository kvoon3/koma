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

Jev picks a leading icon when a text label is committed, and posts to a Worker
proxy in production. The two secrets and the local check live in
[docs/jev-proxy.md](docs/jev-proxy.md).

## Storybook

The component workshop builds and deploys on its own Worker, separate from the
app. `wrangler.storybook.jsonc` serves `storybook-static` as `koma-storybook`,
so a Storybook deploy never touches `koma` or its domain.

```bash
bun run deploy:storybook   # build-storybook, then wrangler deploy with the storybook config
```

The Worker lands at `https://koma-storybook.kvoon.workers.dev`, with preview
URLs at `https://<version-prefix>-koma-storybook.kvoon.workers.dev` for
non-main branches.

Automatic deploys on main need one dashboard step. In the Cloudflare
dashboard, add a second Workers Builds project for this repo, point it at
`main`, and set the build command to `bun run deploy:storybook`. Set the
output directory to `storybook-static` so the project reads the workshop
build. Leave the app's own Workers Builds project as it is.

## License

[MIT](LICENSE) © Kevin Kwong. Third-party notices live in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
