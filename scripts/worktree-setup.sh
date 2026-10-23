#!/bin/sh
# Give a new worktree its own node_modules.
#
# simple-git-hooks wires this as post-checkout, and git runs that hook on every
# `git switch`, `git checkout` and `git worktree add`. Two guards keep a branch
# switch from paying for an install: the main checkout is skipped, and so is a
# worktree that already has node_modules.
#
# Git ignores post-checkout's exit status, so a failed install does not abort
# the checkout. It prints and leaves the tree uninstalled; run `bun install`
# by hand to retry.
set -eu

git_dir=$(git rev-parse --git-dir)
common_dir=$(git rev-parse --git-common-dir)
if [ "$(cd "$git_dir" && pwd -P)" = "$(cd "$common_dir" && pwd -P)" ]; then
  exit 0
fi
if [ -d node_modules ] || [ ! -f bun.lock ]; then
  exit 0
fi

echo "[worktree] installing dependencies in $(pwd)" >&2
bun install --frozen-lockfile >&2
