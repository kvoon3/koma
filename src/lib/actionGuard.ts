/**
 * Typed action descriptors with a declared precondition, enforced in one
 * place (`bindAction`). A `requires: 'pane'` handler receives a non-null
 * target, a `requires: 'photo'` handler a target whose photo is non-null, so
 * no handler can run without what it needs. Route preconditions
 * (`requires: 'stage' | 'grid'`) let the dock show one stable tool set on
 * every route and disable what does not apply; pane/photo (selection)
 * actions also need the stage route. Every surface (dock tools,
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
    | { requires: 'stage', run: () => void }
    | { requires: 'grid', run: () => void }
    | { requires: 'pane', run: (t: PaneTarget<P>) => void, when?: (t: PaneTarget<P>) => boolean }
    | { requires: 'photo', run: (t: PhotoTarget<P>) => void, when?: (t: PhotoTarget<P>) => boolean }

export type Requirement = Action['requires']

/** The route the dock is on: the collage editor or the 3×3 grid overview. */
export type DockRoute = 'stage' | 'grid'

/**
 * What the action can see: the focused pane (null when nothing is selected)
 * and the route. `route` omitted means the stage (the original behavior).
 */
export interface ActionContext<P = unknown> {
  pane: PaneTarget<P> | null
  route?: DockRoute
}

function hasPhoto<P>(t: PaneTarget<P>): t is PhotoTarget<P> {
  return t.photo != null
}

/**
 * The single gate: returns a ready-to-call thunk when the precondition holds,
 * or null (render disabled, ignore the shortcut) when it does not.
 */
export function bindAction<P>(action: Action<P>, ctx: ActionContext<P>): (() => void) | null {
  const route = ctx.route ?? 'stage'
  switch (action.requires) {
    case 'none':
      return action.run
    case 'stage':
    case 'grid':
      return route === action.requires ? action.run : null
    case 'pane': {
      const t = route === 'stage' ? ctx.pane : null
      if (!t || (action.when && !action.when(t)))
        return null
      return () => action.run(t)
    }
    case 'photo': {
      const t = route === 'stage' ? ctx.pane : null
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

/** Whether a requirement holds, for controls without a single action (popover triggers). */
export function canRun<P>(requires: Requirement, ctx: ActionContext<P>): boolean {
  if (requires === 'pane' || requires === 'photo') {
    const t = (ctx.route ?? 'stage') === 'stage' ? ctx.pane : null
    return !!t && (requires === 'pane' || t.photo != null)
  }
  return bindAction({ requires, run: () => {} } as Action<P>, ctx) != null
}
