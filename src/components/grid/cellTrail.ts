import type { TrailPaint } from '../../lib/motionTrail'

export function createCellTrail(id: string): HTMLElement {
  const ghost = document.createElement('span')
  ghost.dataset.cellTrail = id
  ghost.setAttribute('aria-hidden', 'true')
  ghost.className = 'pointer-events-none absolute opacity-0'
  const rim = 'absolute inset-x-0 h-px bg-[linear-gradient(to_left,var(--floatBg),transparent_88%)]'
  for (const edge of ['top-0', 'bottom-0']) {
    const line = document.createElement('span')
    line.className = `${rim} ${edge}`
    ghost.append(line)
  }
  const core = document.createElement('span')
  core.className = 'absolute inset-x-px top-px bottom-px bg-[linear-gradient(to_left,var(--accent),transparent_88%)]'
  ghost.append(core)
  return ghost
}

export function paintCellTrail(ghost: HTMLElement, cell: number, cellH: number) {
  const halfW = cell / 2
  const halfH = cellH / 2
  const cross = Math.max(cell, cellH)
  return ({ head, tail, opacity }: TrailPaint) => {
    if (opacity <= 0) {
      ghost.style.opacity = '0'
      return
    }
    const hx = head.x + halfW
    const hy = head.y + halfH
    const tx = tail.x + halfW
    const ty = tail.y + halfH
    const length = Math.hypot(hx - tx, hy - ty)
    if (length < 0.5) {
      ghost.style.opacity = '0'
      return
    }
    ghost.style.width = `${length}px`
    ghost.style.height = `${cross}px`
    ghost.style.left = `${(hx + tx) / 2 - length / 2}px`
    ghost.style.top = `${(hy + ty) / 2 - cross / 2}px`
    ghost.style.transform = `rotate(${Math.atan2(hy - ty, hx - tx)}rad)`
    ghost.style.opacity = opacity.toFixed(3)
  }
}
