import type { ReactElement } from 'react'
import { Tooltip } from '@base-ui/react/tooltip'

/**
 * A label tooltip on any element: the top bar's menus, the floating page
 * actions and the library cards wrap their triggers in it. The popup opens on
 * hover or keyboard focus and sits above its trigger.
 */
export function Tip({ label, trigger }: { label: string, trigger: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6} className="pointer-events-none z-100">
          <Tooltip.Popup className="pointer-events-none rounded-none border border-line bg-panel-2 px-2 py-1 text-[11px] text-txt origin-[var(--transform-origin)] transition-[opacity,transform] duration-(--dur-fast) ease-(--ease-out) data-starting-style:opacity-0 data-starting-style:translate-y-1 data-ending-style:opacity-0 data-ending-style:translate-y-1 data-instant:transition-none">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
