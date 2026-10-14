import type { ExportItem } from '../components/ExportDialog'

/** A finished render whose preview URL the run that shows it will mint. */
export type RenderedItem = Omit<ExportItem, 'url'>

/**
 * Mint one preview URL per rendered item and release the run this one
 * replaces. Minting and releasing are the two halves of one ownership
 * transfer, so they live in the same function.
 */
export function armRun(rendered: RenderedItem[], previous: ExportItem[] | null): ExportItem[] {
  for (const item of previous ?? [])
    URL.revokeObjectURL(item.url)
  const run: ExportItem[] = []
  for (const item of rendered)
    run.push({ ...item, url: URL.createObjectURL(item.blob) })
  return run
}

/** The dialog has animated out, or a new run replaced this one: let its URLs go. */
export function releaseRun(run: ExportItem[] | null) {
  if (!run)
    return
  for (const item of run)
    URL.revokeObjectURL(item.url)
}
