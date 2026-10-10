// Enforce Conventional Commits: https://www.conventionalcommits.org
// Runs via the commit-msg hook (simple-git-hooks) on every commit.
export default { extends: ['@commitlint/config-conventional'] }
