/**
 * The label icon pick: after a label's text commits, ask Jev which leading
 * icon suits it, then apply the answer only if the label is unchanged.
 *
 * The edit is never blocked or reverted. The UI fires and forgets, a failure
 * leaves the label text-only, and there is no retry. A user-chosen icon wins:
 * the pick starts only for a label with no icon and applies only while the
 * label still has no icon and still carries the text that was sent.
 */
import type { JevConfig } from './jev'
import type { PaneLabel } from './panes'
import { activeWs, useStore } from '../store'
import { pickLabelIcon, readJevConfig } from './jev'
import { LABEL_ICONS } from './labelIcons'

export function labelIconCandidates(): { id: string, description: string }[] {
  return LABEL_ICONS.map(({ id, label }) => ({ id, description: label }))
}

function activeLabel(labelId: string): PaneLabel | undefined {
  return activeWs(useStore.getState()).labels.find(label => label.id === labelId)
}

/**
 * Apply Jev's pick to a label that still carries the committed text and still
 * has no icon. Exported so a test can await the call; the UI fires and forgets.
 */
export async function pickLabelIconFor(
  labelId: string,
  text: string,
  config: JevConfig | null = readJevConfig(),
): Promise<void> {
  if (!config || !text.trim())
    return

  const before = activeLabel(labelId)
  // The commit is not in the store, or the user already chose an icon.
  if (!before || before.icon || before.text !== text)
    return

  const result = await pickLabelIcon(text, labelIconCandidates(), config)
  if (!result.ok || result.pick.icon === null)
    return

  const after = activeLabel(labelId)
  // Gone, edited again, or an icon arrived while the call was in flight.
  if (!after || after.icon || after.text !== text)
    return

  useStore.getState().setLabel(labelId, { icon: result.pick.icon })
}

export function requestLabelIcon(labelId: string, text: string): void {
  void pickLabelIconFor(labelId, text).catch(() => {})
}
