import { LoaderCircle } from 'lucide'
import { MorphIcon } from 'morphicons/react'

/**
 * The app's busy mark: a LoaderCircle turning once every 900ms, sized for the
 * icon slot it occupies. `Button`'s `loading` prop mounts it in place of the
 * icon; raw surfaces (menu items, dialog footers) put it where their icon sits.
 */
export function Spinner({ size = 13, strokeWidth = 1.75, className = '' }: {
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <MorphIcon
      icon={LoaderCircle}
      size={size}
      strokeWidth={strokeWidth}
      className={`animate-spin [animation-duration:900ms]${className ? ` ${className}` : ''}`}
    />
  )
}
