import type { IconNode } from 'morphicons/react'
import {
  Bookmark,
  Camera,
  Cat,
  Coffee,
  Crown,
  Flame,
  Flower2,
  Gift,
  Heart,
  ImagePlus,
  Leaf,
  MapPin,
  Moon,
  Music,
  PartyPopper,
  Smile,
  Sparkles,
  Star,
  Sticker,
  Sun,
  ThumbsUp,
  Type,
  WandSparkles,
  Zap,
} from 'lucide'

export interface StickerIconEntry {
  id: string
  label: string
  icon: IconNode
}

/** Curated lucide subset for text-sticker icon-before-text. */
export const STICKER_ICONS: readonly StickerIconEntry[] = [
  { id: 'heart', label: 'Heart', icon: Heart },
  { id: 'star', label: 'Star', icon: Star },
  { id: 'smile', label: 'Smile', icon: Smile },
  { id: 'sun', label: 'Sun', icon: Sun },
  { id: 'moon', label: 'Moon', icon: Moon },
  { id: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'image-plus', label: 'Image plus', icon: ImagePlus },
  { id: 'type', label: 'Type', icon: Type },
  { id: 'sticker', label: 'Sticker', icon: Sticker },
  { id: 'wand-sparkles', label: 'Wand', icon: WandSparkles },
  { id: 'flower', label: 'Flower', icon: Flower2 },
  { id: 'gift', label: 'Gift', icon: Gift },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'zap', label: 'Zap', icon: Zap },
  { id: 'thumbs-up', label: 'Thumbs up', icon: ThumbsUp },
  { id: 'crown', label: 'Crown', icon: Crown },
  { id: 'party', label: 'Party', icon: PartyPopper },
  { id: 'coffee', label: 'Coffee', icon: Coffee },
  { id: 'cat', label: 'Cat', icon: Cat },
  { id: 'leaf', label: 'Leaf', icon: Leaf },
  { id: 'flame', label: 'Flame', icon: Flame },
  { id: 'map-pin', label: 'Map pin', icon: MapPin },
  { id: 'bookmark', label: 'Bookmark', icon: Bookmark },
]

export function getStickerIcon(id: string | null | undefined): StickerIconEntry | null {
  if (!id)
    return null
  return STICKER_ICONS.find(entry => entry.id === id) ?? null
}
