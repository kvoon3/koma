# AGENTS.md

- Commits: Conventional Commits (`type(scope): summary`), enforced by commitlint.
- Tailwind class strings: keep a space before `${…}` in template literals. A class token glued to the interpolation (`duration-[120ms]${cond ? …}`) is not scanned, so the utility silently never reaches the CSS.
- Worktrees are Herdr-managed: create via `herdr worktree create` / `herdr_worktree_jump`, never bare `git worktree add`.
- Merge back from the main checkout: commit everything in the worktree first (`git add -A`), then `git cherry-pick`, never `git merge`.
- Conflicts: keep both sides (union), then `git -c core.editor=true cherry-pick --continue`.
- After merging: verify (`bun install` if deps changed, `bun run ci`), then `herdr worktree remove --workspace <ID>` and `git branch -D <branch>`.

## Stacked PRs (`gh stack`)

Work with more than one dependent concern ships as a stack: one concern per layer, bottom-up. Never build every concern on `main` and split it later, and never chain dependent concerns into one flat PR.

- **Setup** (once per clone): `gh extension install github/gh-stack`, `git config rerere.enabled true`, `git config remote.pushDefault origin`.
- **Create before writing files**: `gh stack init <bottom-layer>` from `main`, then `gh stack add <next-layer>` per layer. Branch names are lane names verbatim (`waveN/<layer>`).
- **One concern per layer**: never commit a lower layer's change on top of the stack. `gh stack view --json` shows ownership; `gh stack down` / `gh stack checkout <branch>` moves to the owner, then `gh stack rebase --upstack` replays the rest and `gh stack top` returns.
- **Non-interactive only**: bare commands open a TUI and block an agent, so pass the flags: `view --json`, `submit --auto`, `merge <target> --yes`, `init <branch>`, `add <branch>`, `checkout <target>`, `up` / `down` / `top` / `bottom`. Never `gh stack view`, `submit`, `modify` or `switch` bare, and never `gh pr merge` on a stack.
- **Merge bottom-up** with `gh stack merge <pr> --yes` (`--squash` / `--merge` / `--rebase` for the method); it is all-or-nothing. Then `gh stack sync --prune` drops merged local branches. Stacks land on GitHub, so the cherry-pick ritual above is only for branches that are not in a stack.
- **Exit codes**: 2 = not in a stack; 3 = rebase conflict (`git add` then `gh stack rebase --continue`, `--abort` to restore); 6 = branch in several stacks (check out a non-shared one); 7 = rebase already in progress; 9 = stacked PRs not enabled on the repo, so stop and report it instead of falling back to a flat PR.
- **Worktrees**: one stack per Herdr worktree, so a lane is a worktree plus a chain of branches, not one branch. A branch owned by another worktree stays there; locate it with `gh stack checkout <branch> --print-path` instead of stealing the checkout.

## Feature lanes and acceptance

Features ship as lanes: one lane = one Herdr worktree + one stack (`waveN/<layer>` branches, one per dependent concern) + one PR per layer, built by delegated agents. Keep lanes file-disjoint; anything touching the same file serializes. Layers inside one stack are sequential, so they may share files.

- **Agent roles**: code agents run on the `deepseek-flash` template; judgment, review and anything visual run on the `judge` template (glm-5.3-flash, vision input enabled via `modelOverrides` in models.json). Always pass `agent_type` explicitly; a generic subagent inherits the parent model.
- **Briefs** are self-contained (subagents see no parent conversation): file pointers, constraints, lanes to stay out of, and acceptance criteria written as measurable checks.
- **Gates, exit codes only**: never pipe gate commands into `tail` (the pipe masks the failure exit), and never chain them with `;` (the chain continues past a failure). Run `bun run ci` (lint, `bun test --check --isolate src`, and `build`, which type-checks with `bun check` before `vite build`, all in parallel) and require exit 0, on the committed tree. The `--isolate` is not optional: without it every test file shares one module registry, so a file that writes the store (`store.test.ts`, `stickerRecipe.test.ts`) leaks a seeded photo into the next file's boot snapshot, and the result depends on the order the runner picks. CI runs those same three scripts, one runner each. `bun run test:shuffle` (same suite, randomized order) is the cheap way to catch a test that leans on another file's leftovers.
- **Interaction claims need browser measurements** (element rects across a gesture, per-frame samples), not adjectives. Playwright-core from a worktree's node_modules plus the cached Chromium works; seed app state via `window.__collage`.
- **Vision acceptance for UI changes**: before pushing, screenshot the changed views at BOTH sizes (mobile 375×812 AND desktop 1280×900) and have a `judge` agent review the PNGs against the intended design. When the change touches layout geometry, sweep the edges too (short window like 1280×600, landscape phone like 915×412) before the judge pass. Fix and re-shoot until confirmed.
- **Locale keys** go into BOTH `zh-Hans.ts` and `zh-Hant.ts` under a per-lane comment section (union-friendly); `bun scripts/i18n-coverage.mjs` (the pre-commit hook) and `src/lib/i18nDrift.test.ts` (every `bun test`) enforce both directions.
- **Push once per lane**: commit freely in the worktree, but `gh stack push` / `gh stack submit --auto` only when the lane is review-ready, and afterwards only for review fixups; one submit pushes every layer, so it costs a Cloudflare build and three CI runners per branch. Only a lane's final commit is ever reviewed, and the last 16 merged PRs averaged 5 pushes each. `bun run ci` locally is the feedback loop; pushing is not a checkpoint.
- **PRs**: one per layer, created as drafts by `gh stack submit --auto`, whose titles and bodies are auto-generated, so rewrite the body with `gh pr edit` to carry evidence (measurements, screenshot paths, known trade-offs). Locale conflicts between lanes resolve as keep-both; `gh stack rebase --upstack` after a lower layer merges. Humans review and merge with `gh stack merge`; Cloudflare Workers deploys per-branch previews and main on merge. The preview URL is `<branch-slug>-koma.kvoon.workers.dev` (branch lowercased, `/` turned into `-`), so construct it when Cloudflare's own PR comment is late or missing.
