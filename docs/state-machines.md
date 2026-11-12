# State machines

A state machine here is any place where several fields together describe one
lifecycle. The audit below lists every one in the app, whether it is modeled,
already explicit, or deliberately left as refs. The rule is:

> If a flow is async, has three or more phases, or has two or more boolean
> fields that must agree, it gets a pure transition module in `src/lib` and a
> test. Per-frame pointer work stays in refs.

Why: a boolean cluster can represent states the user can never reach on
purpose (saving while a picker covers the subject, adding the previous track
while the next link resolves, starting a second render from a keyboard
shortcut). A phase union cannot. The pure module is also the one place a
reader, an agent, or a test can learn the legal moves without running the UI.

## The pattern

Modeled flows use the same four pieces:

1. A state union with the data each phase owns (`phase` plus its payload).
2. An event union named after user intent, not setters.
3. One pure `transition(state, event)` that returns the same object for a
   refused event.
4. Derived predicates (`canAdd`, `canSaveSticker`, `exportBusy`, `...`) instead
   of recomputing the phase rules at call sites.

`useFlow` (`src/lib/useFlow.ts`) binds a transition to a component. `send`
reads the latest state synchronously, so a double click in one frame, an async
callback, or a late promise cannot act on a state the screen has already left.
Tests live beside each module and cover both accepted and refused edges.

The machines are exposed on `window.__collage.flows` (see `src/debug.ts`), so an
agent can inspect or drive them without a browser.

## Modeled

| Flow | Module | States | What it prevents |
| --- | --- | --- | --- |
| Export run | `src/lib/exportSession.ts` | `idle -> rendering -> previewing -> releasing -> idle` | A second render started by `mod+E` while the first is running; releasing the wrong run's object URLs |
| Music card | `src/lib/musicCardFlow.ts` | `idle -> resolving -> ready -> adding`, plus a lyrics sub-state | Adding the previous track while the next link resolves; starting a resolve mid-add; two lyric lookups |
| Sticker maker shell | `src/lib/stickerMakerFlow.ts` | tab, one of `stage/camera/library/mask`, `saving` | Insert while the mask editor or library picker covers the stage; a second bake; a stale panel after a tab change or reopen |
| Library multi-select | `src/lib/librarySelection.ts` | pick order plus range anchor | A range anchored on a photo the list no longer has; a plain click leaving a batch behind |

## Already explicit

| Flow | Where | Shape |
| --- | --- | --- |
| Tools dock display | `src/lib/toolsDockMode.ts` | `ToolsDockMode` + `DockEvent` + `dockTransition` / `dockDisplayAt` |
| Camera session | `src/components/sticker/CameraCapturePanel.tsx` | `CameraUiState` union (`starting/ready/capturing/error`) |
| Pane cutout job | `src/store.ts` (`cutoutJob`), `src/lib/paneCutout.ts` | `loading/processing` phases, single flight |
| History tree | `src/lib/history.ts` | step tree, cursor, coalescing by tag |
| Action preconditions | `src/lib/actionGuard.ts` | typed requires + one gate |
| Export view | `src/lib/exportView.ts` | clamped `ExportView`, derived frame |
| Canvas view | `src/lib/canvasView.ts` | clamped view, derived frame |
| Label edit request | `src/store.ts` (`labelEditReq`) | monotonic sequence consumed at render |
| WeChat guard | `src/components/WeChatGuard.tsx` | `ask / guide / null` |
| Export preview controls | `src/components/ExportDialog.tsx` | `busy: 'copy' \| 'all' \| null`, selection clamped to the run |

## Left local on purpose

These are real state machines, but their state changes per pointer frame or
belongs to one mounted component. Moving them into React state would add
renders and reads without making an illegal state reachable; the mode unions
and refs are the machine.

| Flow | Where | Why local |
| --- | --- | --- |
| Pane pan / pinch / swap gestures | `src/components/Pane.tsx` (`Gesture`, `PaneGestureRuntime`) | 60fps pointer work; refs are the synchronous truth, React state only mirrors the visible bits (`moving`, `swapArmed`, `swapAt`, `swapReturn`) |
| Sticker maker cutout job | `src/components/StickerMakerDialog.tsx` (`useCutoutJob`) | Token-guarded async job; a newer pick owns the job, a stale result is revoked |
| Live Photo hold / pin | `src/components/Pane.tsx` (`liveFor`, `livePin`) | Two photo ids derive one `live` boolean; playback is a DOM property |
| Divider drag, canvas resize | `src/components/Stage.tsx` | Pointer stream + a ref for the live geometry |
| Board pager, pull-down, long press | `src/components/grid/useStageGestures.ts` | Motion values and a press ref; the axis lock is the machine |
| Grid Shuffle run | `src/components/grid/useGridShuffle.ts` | One 260ms rAF clock plus trail refs; the store order is the truth |
| Mask painting | `src/components/StickerMaskEditor.tsx` | Stroke ref + undo canvas stack per mount |
| Sticker erase commit | `src/components/StickerEraseDialog.tsx` | `ready` / `busy` for one dialog mount |
| Groups page enter / leave | `src/components/groups/GroupsPage.tsx` | Animation bookkeeping keyed by group id |
| Chrome panels | `src/router.tsx`, `src/components/TopBar.tsx` | Open flags for modal surfaces; base-ui owns the transitions |
| Boot / hydrate | `src/main.tsx` | The app renders only after `loadSession` resolves; there is no intermediate screen |
| Appearance background pick | `src/components/AppearanceTools.tsx` | One intent flag (`pendingImage`) until a photo lands |

## Adding or changing a flow

1. Write `src/lib/<flow>.ts`: state union, event union, `transition`, derived
   predicates. Keep it free of React and of translated strings.
2. Test the accepted path and every refused event in
   `src/lib/<flow>.test.ts`.
3. Bind it with `useFlow` in the component. Use `latest()` inside async
   callbacks, never a captured render value.
4. Add the module to `window.__collage.flows` in `src/debug.ts` and to the
   Modeled table above.
5. Keep user-visible copy in the locale dictionaries as usual; the machine
   carries a translated `error` string, not a key.
