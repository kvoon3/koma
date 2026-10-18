/**
 * The editor preview's label unit (px per ‰ of the board's short edge),
 * published by Stage so the exporter can measure text at the size the preview
 * actually laid out.
 *
 * Canvas metrics at a 2048 px export are NOT simply the preview's metrics
 * scaled up: the macOS system font (`-apple-system`) has size-dependent
 * advances, so a line measured at 86 px comes out ~2% narrower than the same
 * line at 34 px scaled to 86 px. Measuring the export at the preview's size and
 * scaling the result keeps every line exactly where the preview drew it, at any
 * export resolution. Grid exports (no editor preview mounted) fall back to
 * their own unit.
 */
let previewUnit = 0

export function setLabelPreviewUnit(unit: number): void {
  previewUnit = Number.isFinite(unit) && unit > 0 ? unit : 0
}

/** 0 when no editor preview has published a unit yet. */
export function labelPreviewUnit(): number {
  return previewUnit
}
