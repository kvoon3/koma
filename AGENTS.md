# AGENTS.md

This repo runs poteto mode. Process comes from the poteto skills at
`/Users/kvoon/.claude/plugins/marketplaces/cursor-plugins/pstack/skills/poteto-mode/SKILL.md`
and its playbooks. The notes below are repo facts those playbooks cannot infer.
Where a note conflicts with a poteto default, the note wins.

## Code

- Conventional Commits, enforced by commitlint.
- Tailwind: keep a space before `${…}` in class template literals. A glued token is not scanned.
- Locale keys go in every dictionary under `src/lib/locales` (`zh-Hans.ts`, `zh-Hant.ts`, `ja.ts`)
  under a per-lane comment. `zh-Hans` is the key universe, so a new string lands there first.
  `x18n` enforces it: `bun run i18n` (`x18n check`, wired into `bun run ci` and the pre-commit
  hook) owns parity, dead keys, empty values and placeholders. `missing-key` is off on
  purpose: the compiler owns call-site validity (`t` takes `TKey`). A key that reaches `t`
  through a data table instead of a direct call carries a `// @x18n-keys` marker on its table.

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

- A lane gets its own worktree; never run two lanes in the main checkout. The checkout is
  plain git: `git worktree add ~/.herdr/worktrees/koma/<name> -b <branch>`, and
  `git worktree remove` once merged. Herdr is only a viewer: `herdr worktree open --path
  <path>` adds one to the sidebar, and a worktree that is open there comes down with
  `herdr worktree remove --workspace <ID>` so its workspace goes with it.
  `scripts/worktree-setup.sh`, wired as the post-checkout hook, installs a new
  worktree's dependencies; if it was skipped (an old branch, or a non-git creator),
  run `bun install` there.
- Never `reset --hard` a worktree another lane owns; its uncommitted edits do not survive.
- Branch names are `waveN/<layer>`. Preview URL: `<branch-slug>-koma.kvoon.workers.dev`.

## Exceptions to poteto defaults

- Stacks are base-branch chains via `gh pr create --base`, one concern per layer.
  Do not use `gh stack`; poteto's Shipping and Babysit own stack topology.
- Local `bun run ci` is the feedback loop. Push when a lane is review-ready.
