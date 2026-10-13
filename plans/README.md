# Animation plans -- koma

Written by `improve-animations` at commit `257585e`. Each plan is self-contained; executors need zero context. Verify the feel-checks by hand -- motion can be mechanically correct and still wrong.

| # | Plan | Severity | Category | Status |
|---|---|---|---|---|
| 001 | [Press feedback on every control](001-press-feedback.md) | HIGH | Physicality | DONE (`b9d0a52`) |
| 002 | [Reduced-motion gate + repo curve for dnd drop](002-dnd-drop-reduced-motion.md) | MEDIUM | Accessibility / Cohesion | DONE (`dcfcfe8`) |
| 003 | [Duration tokens + consolidation](003-duration-tokens.md) | MEDIUM | Cohesion / Easing | DONE (`fb350ca`) |
| 004 | [Photo decode fade-in](004-photo-fade-in.md) | LOW | Missed opportunity | DONE (`c5f159d`) |

## Recommended execution order

**001 → 002 → 004 → 003.**

- **001 first**: highest leverage (one pattern, ~25 sites, every control in the app), and completely independent.
- **002 second**: two tiny edits, independent of everything.
- **004 third**: independent, additive; its `.photo-in` class uses a literal `200ms` so it does not wait for 003.
- **003 last**: it is a repo-wide sweep and its mapping table includes the `duration-[120ms]` literals that 001 adds. Running it last means one pass tokenizes everything, old and new.

## Dependencies

- 003 depends on the others having landed (its "after" grep counts assume 001's additions exist). If 003 must run first, re-verify its mapping table against the tree at that commit.
- No other cross-dependencies; 002 and 004 are parallelizable.

## Audit results not planned (vetted out or declined)

- Tailwind's implicit default hover curve (~40 sites) -- matches the intended curve; tokenizing adds churn, zero feel change.
- `Pane.tsx:837` WAAPI literal -- documented, token-equal.
- Toast `height` transition -- Base UI stack recipe, tiny and infrequent.
- SeamBackdrop blur radius -- static raster cost, not a motion cost.
- Swap-drop commit without velocity threshold -- target selection, not dismissal; correct as-is.
- Toast symmetric 150/150 timing -- real but one-line; fold into a future pass if toasts ever get revisited.
