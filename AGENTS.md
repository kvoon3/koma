# AGENTS.md

Guidelines for coding agents working in this repo (main checkout or worktrees).

## Commit messages

Conventional Commits, **enforced** by commitlint via the `commit-msg` hook:

```
type(scope): short imperative summary

optional body
```

- Allowed types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- Scope is optional but encouraged (`feat(panes):`, `fix(labels):`, …)
- The pre-commit hook runs `eslint --fix` on staged `*.{ts,tsx}`

## Worktree workflow

Worktrees live at `~/.herdr/worktrees/koma/worktree-<name>` on branches
`worktree-<name>`, branched from the current `main` HEAD.

**House rule: merge back with `git cherry-pick` only — never `git merge`.**
History stays linear; `main` must not gain merge commits from worktree branches.

Merging a worktree back:

1. **Commit everything in the worktree first** — including untracked files
   (`git add -A`). No uncommitted changes may be left behind. Messages follow
   Conventional Commits (hooks run here too).
2. **Cherry-pick from the main checkout**:
   `git cherry-pick <hash>...` (one or more commits).
3. **Conflicts**: resolve as a union — keep both sides' features unless they
   are truly mutually exclusive. Then `git add -A` and
   `git -c core.editor=true cherry-pick --continue`.
4. **Verify on main**: `bun install` if `package.json` / `bun.lock` changed,
   then `npx tsc --noEmit && npx vite build`.
5. **Clean up**: `git worktree remove <path>` and `git branch -D <branch>`.
   The worktree and its branch do not outlive the merge.

History rules:

- Only rewrite commits that are local and unpushed (rebase / reword / amend).
- Never rewrite pushed history.
