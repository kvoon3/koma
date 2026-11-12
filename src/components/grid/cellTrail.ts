import type { TrailPaint } from '../../lib/motionTrail'

const PAD = 2
const TAIL_MAX = 220
const TAIL_CROSS = 26

export function createCellTrail(id: string, cell: number, cellH: number): HTMLElement {
  const ghost = document.createElement('span')
  ghost.dataset.cellTrail = id
  ghost.setAttribute('aria-hidden', 'true')
  ghost.className = 'pointer-events-none absolute inset-0'
  const glow = document.createElement('span')
  glow.dataset.cellGlow = ''
  glow.className = 'absolute rounded-[4px] opacity-0'
  glow.style.width = `${cell + PAD * 2}px`
  glow.style.height = `${cellH + PAD * 2}px`
  glow.style.boxShadow = '0 0 22px 4px color-mix(in srgb, var(--accent) 32%, transparent)'
  glow.style.willChange = 'transform, opacity'
  ghost.append(glow)
  const tail = document.createElement('span')
  tail.dataset.cellTail = ''
  tail.className = 'absolute rounded-full opacity-0'
  tail.style.width = `${TAIL_MAX}px`
  tail.style.height = `${TAIL_CROSS}px`
  tail.style.transformOrigin = '0 50%'
  tail.style.background = 'linear-gradient(to right, var(--accent), transparent 92%)'
  tail.style.filter = 'blur(7px)'
  tail.style.willChange = 'transform, opacity'
  ghost.append(tail)
  return ghost
}

export function paintCellTrail(ghost: HTMLElement, cell: number, cellH: number) {
  const glowEl = ghost.querySelector<HTMLElement>('[data-cell-glow]')!
  const tailEl = ghost.querySelector<HTMLElement>('[data-cell-tail]')
  const halfW = cell / 2
  const halfH = cellH / 2
  return ({ head, tail, opacity }: TrailPaint) => {
    const hx = head.x + halfW
    const hy = head.y + halfH
    const tx = tail.x + halfW
    const ty = tail.y + halfH
    const gap = Math.hypot(hx - tx, hy - ty)
    if (gap < 0.5) {
      glowEl.style.opacity = '0'
      if (tailEl)
        tailEl.style.opacity = '0'
      return
    }
    const presence = gap > 16 ? 0.35 : 0
    glowEl.style.transform = `translate3d(${head.x - PAD}px, ${head.y - PAD}px, 0)`
    glowEl.style.opacity = Math.min(0.9, presence + opacity).toFixed(3)
    if (!tailEl)
      return
    const ux = (hx - tx) / gap
    const uy = (hy - ty) / gap
    const reach = halfW * Math.abs(ux) + halfH * Math.abs(uy)
    const edgeX = hx - ux * reach
    const edgeY = hy - uy * reach
    const length = Math.max(0, gap - reach)
    tailEl.style.transform = `translate3d(${edgeX}px, ${edgeY - TAIL_CROSS / 2}px, 0) rotate(${Math.atan2(-uy, -ux)}rad) scaleX(${Math.min(1, length / TAIL_MAX)})`
    tailEl.style.opacity = Math.min(0.75, opacity).toFixed(3)
  }
}
