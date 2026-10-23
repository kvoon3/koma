import { MorphIcon } from 'morphicons/react'
import { TAG_ICON_NODES, tagIcon } from '../../lib/tagIcons'

export function TagGlyph({ name, size = 10, className }: {
  name: string
  size?: number
  className?: string
}) {
  const key = tagIcon(name)
  return (
    <span className={`inline-flex flex-none items-center ${className ?? ''}`} data-tag-icon={key}>
      <MorphIcon icon={TAG_ICON_NODES[key]} size={size} strokeWidth={1.75} />
    </span>
  )
}
