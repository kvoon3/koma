/**
 * The dock's content-space geometry: a tool's layout box relative to the tools
 * container, in px, independent of scroll and of every in-flight transform.
 * Measure, the display band and the hover box all read the same definition, so
 * a placement and an endpoint cannot disagree about where a button is.
 */

/**
 * A child's layout box relative to its container, px. `offsetLeft/Top` are
 * relative to the nearest positioned ancestor rather than to the parent node,
 * and the tools container is deliberately unpositioned, so its own offsets are
 * what makes a child's box container-relative. `offsetParent` is checked
 * rather than assumed: the scroller (an ancestor of the container) is
 * positioned for the hover box, which puts the container's offsets at 0, but a
 * container that gains `position` must not silently shift every endpoint.
 */
export function boxIn(container: HTMLElement, child: HTMLElement): { x: number, y: number } {
  if (child.offsetParent === container)
    return { x: child.offsetLeft, y: child.offsetTop }
  return { x: child.offsetLeft - container.offsetLeft, y: child.offsetTop - container.offsetTop }
}

/** Every direct child's layout box, keyed by element (see `boxIn`). */
export function captureChildBoxes(container: HTMLElement): Map<HTMLElement, { x: number, y: number }> {
  const boxes = new Map<HTMLElement, { x: number, y: number }>()
  for (const child of container.children)
    boxes.set(child as HTMLElement, boxIn(container, child as HTMLElement))
  return boxes
}
