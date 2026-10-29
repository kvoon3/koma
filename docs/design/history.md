# Undo: a step tree, not a pair of stacks (`lib/history.ts`)

Every board mutation commits the state it is about to change (`commit(tag)`),
which becomes a step hanging off the cursor; the cursor is the step the board
is at. Code and tests own the mechanics; these notes hold the decisions.

- **Redo returns where you came from**, not to the newest branch: ⇧⌘Z walks
  down into the child the cursor last visited, and a jump from the panel
  rewrites that visited chain, so redo always continues the line you were
  last on.
- **Acting from a step that has children replaces them.** The child redo
  would have walked into, and its whole subtree, are deleted, with no prompt
  and no soft-delete state. That is the product's chosen trade: one clean
  main line instead of a bush of near-identical variants. In practice a
  session's tree is therefore one chain.
- **One gesture is one step.** Commits carrying the same streaming tag inside
  600ms (`rotatePane:<id>`, `moveSticker:<id>`, `setCanvasSize`) collapse
  into the step the gesture opened. Only gesture tags coalesce, so two quick
  clicks on Split are two steps.
- **The cap is 400 steps** (`HISTORY_LIMIT`). Off-path leaves go first,
  oldest first; a tree that is only the cursor's path (every session, per the
  rule above) drops its root and re-roots one step down, like the old linear
  stack. The tree is session-only: a reload, a hydrated session or an opened
  file forgets it.
