import type { Photo } from '../lib/imageStore'
import { useEffect, useRef, useState } from 'react'
import { usePreview } from '../hooks'
import { hasBgLayers, paintCollageBg } from '../lib/collageBg'
import { useStore } from '../store'

/**
 * The Stage's whole-collage background layers (gradient / photo) over the gap
 * fill. Painted by the exporter's own `paintCollageBg` onto a canvas the size
 * of the stage (device pixels), so the preview and the export match.
 */
export function CollageBgLayer({ W, H, photoById }: { W: number, H: number, photoById: Map<string, Photo> }) {
  const bg = useStore(s => s.bg)
  const gradient = useStore(s => s.bgGradient)
  const image = useStore(s => s.bgImage)
  const photo = image ? photoById.get(image.photoId) ?? null : null
  const preview = usePreview(photo)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const ref = useRef<HTMLCanvasElement>(null)
  const url = preview?.url ?? null

  // Decode the preview into an <img> the canvas can draw (external resource).
  useEffect(() => {
    if (!url)
      return
    let alive = true
    const im = new Image()
    im.onload = () => alive && setImg(im)
    im.src = url
    return () => {
      alive = false
    }
  }, [url])

  const on = hasBgLayers({ bg, gradient, image }, !!photo)
  const drawn = img && img.src === url ? img : null

  // Repaint the canvas whenever the layers or the stage size change.
  useEffect(() => {
    const c = ref.current
    if (!c || !on)
      return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    c.width = Math.max(1, Math.round(W * dpr))
    c.height = Math.max(1, Math.round(H * dpr))
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    paintCollageBg(ctx, c.width, c.height, { bg, gradient, image }, drawn && { src: drawn, w: drawn.naturalWidth, h: drawn.naturalHeight })
  }, [on, W, H, bg, gradient, image, drawn])

  if (!on)
    return null
  return <canvas ref={ref} data-collage-bg="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
}
