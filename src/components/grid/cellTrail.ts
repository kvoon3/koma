import type { TrailPaint } from '../../lib/motionTrail'

export function createCellTrail(id: string): HTMLElement {
  const ghost = document.createElement('span')
  ghost.dataset.cellTrail = id
  ghost.setAttribute('aria-hidden', 'true')
  ghost.className = 'pointer-events-none absolute inset-0'
  const tail = document.createElement('span')
  tail.dataset.cellTail = ''
  tail.className = 'absolute rounded-full bg-[linear-gradient(to_left,var(--accent),transparent_85%)] opacity-0'
  const aura = document.createElement('span')
  aura.dataset.cellAura = ''
  aura.className = 'absolute rounded-[4px] border-[1.5px] border-accent opacity-0'
  aura.style.boxShadow = '0 0 0 1px var(--floatBg), 0 0 18px color-mix(in srgb, var(--accent) 50%, transparent)'
  ghost.append(tail, aura)
  return ghost
}

export function paintCellTrail(ghost: HTMLElement, cell: number, cellH: number) {
  const tailEl = ghost.querySelector<HTMLElement>('[data-cell-tail]')!
  const auraEl = ghost.querySelector<HTMLElement>('[data-cell-aura]')!
  const halfW = cell / 2
  const halfH = cellH / 2
  const pad = 3
  const cross = 22
  const cape = 64
  return ({ head, tail, opacity }: TrailPaint) => {
    const hx = head.x + halfW
    const hy = head.y + halfH
    const tx = tail.x + halfW
    const ty = tail.y + halfH
    const gap = Math.hypot(hx - tx, hy - ty)
    if (gap < 0.5) {
      auraEl.style.opacity = '0'
      tailEl.style.opacity = '0'
      return
    }
    const presence = gap > 12 ? 0.3 : 0
    auraEl.style.left = `${head.x - pad}px`
    auraEl.style.top = `${head.y - pad}px`
    auraEl.style.width = `${cell + pad * 2}px`
    auraEl.style.height = `${cellH + pad * 2}px`
    auraEl.style.opacity = Math.min(0.95, presence + opacity * 1.1).toFixed(3)
    const ux = (hx - tx) / gap
    const uy = (hy - ty) / gap
    const reach = halfW * Math.abs(ux) + halfH * Math.abs(uy)
    const edgeX = hx - ux * reach
    const edgeY = hy - uy * reach
    const length = Math.max(cape, gap - reach)
    const endX = edgeX - ux * length
    const endY = edgeY - uy * length
    tailEl.style.width = `${length}px`
    tailEl.style.height = `${cross}px`
    tailEl.style.left = `${(endX + edgeX) / 2 - length / 2}px`
    tailEl.style.top = `${(endY + edgeY) / 2 - cross / 2}px`
    tailEl.style.transform = `rotate(${Math.atan2(edgeY - endY, edgeX - endX)}rad)`
    tailEl.style.opacity = Math.min(0.9, presence + opacity).toFixed(3)
  }
}
