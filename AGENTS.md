# AGENTS.md

This repo runs poteto mode. Process comes from the poteto skills at
`/Users/kvoon/.claude/plugins/marketplaces/cursor-plugins/pstack/skills/poteto-mode/SKILL.md`
and its playbooks. The notes below are repo facts those playbooks cannot infer.
Where a note conflicts with a poteto default, the note wins.

## Code

- Conventional Commits, enforced by commitlint.
- Tailwind: keep a space before `${…}` in class template literals. A glued token is not scanned.
- Locale keys go in both `zh-Hans.ts` and `zh-Hant.ts` under a per-lane comment.
  `bun scripts/i18n-coverage.mjs` and `src/lib/i18nDrift.test.ts` enforce both directions.

## Gates

- `bun run ci` must exit 0 on the committed tree. Never pipe a gate into `tail`
  or chain it with `;`.
- `--isolate` is required. Without it `store.test.ts` and `stickerRecipe.test.ts`
  leak a seeded photo into the next file's boot snapshot, and the result depends
  on file order.
- `bun run test:shuffle` catches tests that lean on another file's leftovers.

## UI

- Interaction claims need browser measurements, not adjectives. Playwright-core from
  the worktree's `node_modules` plus the cached Chromium; seed state via `window.__collage`.
- Screenshot at 375×812 and 1280×900 before push, plus 1280×600 and 915×412 when
  geometry changes. A vision-capable agent (Herdr `judge` when available) reviews the PNGs.
- Cloudflare deploys main on merge. Merging is irreversible: only on an explicit ask.

## Worktrees and branches

- Worktrees are Herdr-managed: `herdr worktree create`, `herdr worktree remove --workspace <ID>`.
  Never bare `git worktree add/remove/prune`, and never `reset --hard` a Herdr worktree.
- Branch names are `waveN/<layer>`. Preview URL: `<branch-slug>-koma.kvoon.workers.dev`.

## Exceptions to poteto defaults

- Stacks are base-branch chains via `gh pr create --base`, one concern per layer.
  Do not use `gh stack`; poteto's Shipping and Babysit own stack topology.
- Local `bun run ci` is the feedback loop. Push when a lane is review-ready.
