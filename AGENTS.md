# AGENTS.md

- Commits: Conventional Commits (`type(scope): summary`), enforced by commitlint.
- Tailwind class strings: keep a space before `${…}` in template literals. A class token glued to the interpolation (`duration-[120ms]${cond ? …}`) is not scanned, so the utility silently never reaches the CSS.
- Worktrees are Herdr-managed: create via `herdr worktree create` / `herdr_worktree_jump`, never bare `git worktree add`.
- Merge back from the main checkout: commit everything in the worktree first (`git add -A`), then `git cherry-pick`, never `git merge`.
- Conflicts: keep both sides (union), then `git -c core.editor=true cherry-pick --continue`.
- After merging: verify (`bun install` if deps changed, `npx tsc --noEmit && npx vite build`), then `herdr worktree remove --workspace <ID>` and `git branch -D <branch>`.

## Feature lanes and acceptance

Features ship as lanes: one lane = one worktree + one branch (`waveN/<lane>`) + one PR against main, built by delegated agents. Keep lanes file-disjoint; anything touching the same file serializes.

- **Agent roles**: code agents run on the `deepseek-flash` template; judgment, review and anything visual run on the `judge` template (glm-5.3-flash, vision input enabled via `modelOverrides` in models.json). Always pass `agent_type` explicitly; a generic subagent inherits the parent model.
- **Briefs** are self-contained (subagents see no parent conversation): file pointers, constraints, lanes to stay out of, and acceptance criteria written as measurable checks.
- **Gates, exit codes only** — never pipe gate commands into `tail` (the pipe masks the failure exit): `npx tsc --noEmit`; `npx vite build`; `bun test src`; `bun run lint`. All must exit 0 on the committed tree.
- **Interaction claims need browser measurements** (element rects across a gesture, per-frame samples), not adjectives. Playwright-core from a worktree's node_modules plus the cached Chromium works; seed app state via `window.__collage`.
- **Vision acceptance for UI changes**: before pushing, screenshot the changed views at 375×812 (mobile is the bar) and the desktop width, then have a `judge` agent review the PNGs against the intended design. Fix and re-shoot until confirmed.
- **Locale keys** go into BOTH `zh-Hans.ts` and `zh-Hant.ts` under a per-lane comment section (union-friendly); the eslint i18n-coverage rule and `src/lib/i18nDrift.test.ts` enforce both directions.
- **PRs**: one per lane, body carries evidence (measurements, screenshot paths, known trade-offs). Locale conflicts between lanes resolve as keep-both; rebalance by rebasing after a sibling merges. Humans review and merge; Cloudflare Workers deploys per-branch previews (`<branch-slug>-koma.kvoon.workers.dev`) and main on merge.
