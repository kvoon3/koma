import type { IconNode } from 'lucide'
import { Camera, Coffee, Flame, Flower2, Heart, MapPin, Moon, Music, PartyPopper, Plane, Smile, Sparkles, Star, Sun, ThumbsUp, Zap } from 'lucide'

/**
 * Curated icons a board text label can lead with. Ids are stored on the label,
 * so keep existing ids stable; unknown ids simply draw no icon.
 */
export const LABEL_ICONS: { id: string, label: string, node: IconNode }[] = [
  { id: 'heart', label: 'Heart', node: Heart },
  { id: 'star', label: 'Star', node: Star },
  { id: 'sparkles', label: 'Sparkles', node: Sparkles },
  { id: 'smile', label: 'Smile', node: Smile },
  { id: 'sun', label: 'Sun', node: Sun },
  { id: 'moon', label: 'Moon', node: Moon },
  { id: 'flame', label: 'Flame', node: Flame },
  { id: 'zap', label: 'Zap', node: Zap },
  { id: 'flower', label: 'Flower', node: Flower2 },
  { id: 'music', label: 'Music', node: Music },
  { id: 'camera', label: 'Camera', node: Camera },
  { id: 'coffee', label: 'Coffee', node: Coffee },
  { id: 'plane', label: 'Plane', node: Plane },
  { id: 'pin', label: 'Pin', node: MapPin },
  { id: 'party', label: 'Party', node: PartyPopper },
  { id: 'thumbs-up', label: 'Thumbs up', node: ThumbsUp },
]

export function labelIconNode(id?: string): IconNode | null {
  return id ? (LABEL_ICONS.find(i => i.id === id)?.node ?? null) : null
}

/** Icon edge relative to the label font size, and the gap before the text. */
export const LABEL_ICON_EM = 1
export const LABEL_ICON_GAP_EM = 0.3

function escapeAttr(v: string) {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Standalone SVG markup for an icon in one stroke color (export rasterizes it). */
export function labelIconSvg(node: IconNode, color: string): string {
  const body = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(String(v))}"`).join(' ')}/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${escapeAttr(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

/** Decode an icon for canvas drawing; null if the browser refuses the SVG. */
export function loadLabelIcon(node: IconNode, color: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelIconSvg(node, color))}`
  })
}
