import type { Meta, StoryObj } from '@storybook/react-vite'
import type { PointerEvent } from 'react'
import type { ScaleMark, TickScaleProps } from './TickScale'
import { useRef } from 'react'
import { useArgs } from 'storybook/preview-api'
import { SCALE_MARK_HARD, SCALE_MARK_SOFT, TickScale } from './TickScale'

const ticks: ScaleMark[] = Array.from({ length: 13 }, (_, i) => ({
  at: i / 12,
  length: i % 3 === 0 ? SCALE_MARK_HARD : SCALE_MARK_SOFT,
  strong: i % 3 === 0,
}))

function proximity(at: number, value: number) {
  return Math.max(0, 1 - Math.abs(at - value) * 2)
}

function ScaleDemo() {
  const [args, updateArgs] = useArgs<TickScaleProps>()
  const { ticks, value, orientation = 'horizontal', tone = 'panel', growth = 0.6, ...scale } = args
  const ref = useRef<HTMLDivElement>(null)
  const vertical = orientation === 'vertical'

  const setValue = (next: number) => updateArgs({ value: Math.min(1, Math.max(0, next)) })

  const follow = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect)
      return
    const length = vertical ? rect.height : rect.width
    const pos = vertical ? e.clientY - rect.top : e.clientX - rect.left
    setValue(pos / length)
  }

  const back = vertical ? 'ArrowUp' : 'ArrowLeft'
  const forward = vertical ? 'ArrowDown' : 'ArrowRight'
  const frame = tone === 'float'
    ? 'h-48 w-16'
    : vertical ? 'h-48 w-16 border border-line bg-panel' : 'h-12 w-72 border border-line bg-panel'
  const backdrop = tone === 'float'
    ? { background: 'linear-gradient(160deg, var(--dim), var(--accent))' }
    : undefined

  return (
    <div
      ref={ref}
      role="slider"
      aria-orientation={orientation}
      aria-label="Demo scale"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)}%`}
      tabIndex={0}
      className={`relative touch-none select-none outline-0 focus-visible:outline-1 focus-visible:outline-accent ${
        vertical ? 'cursor-ns-resize' : 'cursor-ew-resize'} ${frame}`}
      style={backdrop}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        follow(e)
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0)
          follow(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault()
          setValue(e.key === 'Home' ? 0 : 1)
        }
        else if (e.key === back || e.key === forward) {
          e.preventDefault()
          setValue(value + (e.key === forward ? 1 : -1) / 12)
        }
      }}
    >
      <TickScale
        {...scale}
        ticks={ticks.map(mark => ({ ...mark, near: proximity(mark.at, value) }))}
        value={value}
        orientation={orientation}
        tone={tone}
        growth={growth}
      />
    </div>
  )
}

const meta = {
  title: 'UI/TickScale',
  component: TickScale,
  tags: ['autodocs'],
  args: { ticks, value: 0.5, orientation: 'horizontal', tone: 'panel', growth: 0.6 },
  render: ScaleDemo,
} satisfies Meta<typeof TickScale>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
}

export const FloatingOverPhoto: Story = {
  args: { orientation: 'vertical', tone: 'float' },
}
