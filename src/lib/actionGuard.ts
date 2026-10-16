/**
 * Typed action descriptors with a declared precondition, enforced in one
 * place (`bindAction`). A `requires: 'pane'` handler receives a non-null
 * target, a `requires: 'photo'` handler a target whose photo is non-null, so
 * no handler can run without what it needs, and every surface (dock tools,
 * popover options, keyboard shortcuts) asks the same function whether the
 * action is available.
 */

export interface PaneTarget<P = unknown> {
  paneId: string
  photo: P | null
}
export type PhotoTarget<P = unknown> = PaneTarget<P> & { photo: P }

export type Action<P = unknown>
  = | { requires: 'none', run: () => void }
    | { requires: 'pane', run: (t: PaneTarget<P>) => void, when?: (t: PaneTarget<P>) => boolean }
    | { requires: 'photo', run: (t: PhotoTarget<P>) => void, when?: (t: PhotoTarget<P>) => boolean }

export type Requirement = Action['requires']

/** What the action can see: the focused pane, or null when nothing is selected. */
export interface ActionContext<P = unknown> {
  pane: PaneTarget<P> | null
}

function hasPhoto<P>(t: PaneTarget<P>): t is PhotoTarget<P> {
  return t.photo != null
}

/**
 * The single gate: returns a ready-to-call thunk when the precondition holds,
 * or null (render disabled, ignore the shortcut) when it does not.
 */
export function bindAction<P>(action: Action<P>, ctx: ActionContext<P>): (() => void) | null {
  switch (action.requires) {
    case 'none':
      return action.run
    case 'pane': {
      const t = ctx.pane
      if (!t || (action.when && !action.when(t)))
        return null
      return () => action.run(t)
    }
    case 'photo': {
      const t = ctx.pane
      if (!t || !hasPhoto(t) || (action.when && !action.when(t)))
        return null
      return () => action.run(t)
    }
  }
}

/** Build the context from a focus id, rejecting ids that are not live panes. */
export function paneContext<P>(
  focusId: string | null | undefined,
  lookup: (id: string) => { photo: P | null } | null | undefined,
): ActionContext<P> {
  if (!focusId)
    return { pane: null }
  const hit = lookup(focusId)
  return { pane: hit ? { paneId: focusId, photo: hit.photo } : null }
}
