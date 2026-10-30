import type { Dispatch, SetStateAction } from 'react'
import type { DockMetrics } from '../lib/dockMetrics'
import type { DockCapacity } from '../lib/toolsDockMode'
import { createContext, use } from 'react'
import { DOCK_METRICS_FALLBACK } from '../lib/dockMetrics'

/** The route content the dock is currently showing. */
export interface DockSlot {
  hidden: boolean
  contextKey: string
  /** A page folds the dock to its icon row without writing the stored mode. */
  compact: boolean
}

export interface DockCtx {
  target: HTMLDivElement | null
  setSlot: Dispatch<SetStateAction<DockSlot | null>>
  metrics: DockMetrics
  setMetrics: Dispatch<SetStateAction<DockMetrics>>
  capacity: DockCapacity
  setCapacity: Dispatch<SetStateAction<DockCapacity>>
}

export const ToolsDockContext = createContext<DockCtx | null>(null)

/** The dock's measured heights; the fallbacks until the sheet has measured. */
export function useDockMetrics(): DockMetrics {
  return use(ToolsDockContext)?.metrics ?? DOCK_METRICS_FALLBACK
}

/** Whether the current tools fit one row, measured by the sheet. */
export function useDockCapacity(): DockCapacity {
  return use(ToolsDockContext)?.capacity ?? { fitsOneRow: true }
}
