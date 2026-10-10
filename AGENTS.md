# AGENTS.md

- Commits: Conventional Commits (`type(scope): summary`), enforced by commitlint.
- Worktrees are Herdr-managed: create via `herdr worktree create` / `herdr_worktree_jump`, never bare `git worktree add`.
- Merge back from the main checkout: commit everything in the worktree first (`git add -A`), then `git cherry-pick` — never `git merge`.
- Conflicts: keep both sides (union), then `git -c core.editor=true cherry-pick --continue`.
- After merging: verify (`bun install` if deps changed, `npx tsc --noEmit && npx vite build`), then `herdr worktree remove --workspace <ID>` and `git branch -D <branch>`.
- Never rewrite pushed history.
