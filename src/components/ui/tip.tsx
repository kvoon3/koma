import type { ReactElement } from 'react'
import { Tooltip } from '@base-ui/react/tooltip'

export function Tip({ label, trigger }: { label: string, trigger: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6} className="pointer-events-none z-100">
          <Tooltip.Popup className="pointer-events-none rounded-none border border-line bg-panel-2 px-2 py-1 text-[11px] text-txt origin-[var(--transform-origin)] transition-[opacity,transform] duration-[125ms] ease-(--ease-out) data-starting-style:opacity-0 data-starting-style:translate-y-1 data-ending-style:opacity-0 data-ending-style:translate-y-1 data-instant:transition-none">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
