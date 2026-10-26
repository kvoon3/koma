import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ScaleMark } from './TickScale'
import { useRef, useState } from 'react'
import { SCALE_MARK_HARD, SCALE_MARK_SOFT, TickScale } from './TickScale'

const ticks: ScaleMark[] = Array.from({ length: 13 }, (_, i) => ({
  at: i / 12,
  length: i % 3 === 0 ? SCALE_MARK_HARD : SCALE_MARK_SOFT,
  strong: i % 3 === 0,
}))

/** A mark brightens as the bar nears it: the rail's reading, not the dial's. */
const nearTicks: ScaleMark[] = ticks.map(tick => ({
  ...tick,
  near: 1 - Math.abs(tick.at - 0.5) * 2,
}))

const meta = {
  title: 'UI/TickScale',
  component: TickScale,
  tags: ['autodocs'],
  args: {
    ticks: nearTicks,
    value: 0.5,
    orientation: 'horizontal',
    tone: 'panel',
    growth: 0,
    inset: 0,
    barScale: 1,
    barMotion: 'still',
  },
  render: args => (
    <div
      className={
        args.orientation === 'vertical'
          ? 'relative h-48 w-16 border border-line bg-panel'
          : 'relative h-12 w-72 border border-line bg-panel'
      }
    >
      <TickScale {...args} />
    </div>
  ),
} satisfies Meta<typeof TickScale>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  argTypes: {
    ticks: { control: false },
    value: { control: 'number', min: 0, max: 1, step: 0.01 },
    orientation: { control: 'select', options: ['horizontal', 'vertical'] },
    tone: { control: 'select', options: ['panel', 'float'] },
    growth: { control: 'number', min: 0, max: 1, step: 0.05 },
    inset: { control: 'number', min: 0, max: 12, step: 1 },
    barScale: { control: 'number', min: 1, max: 2, step: 0.1 },
    barMotion: { control: 'select', options: ['still', 'settle'] },
  },
}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
}

export const FloatingOverPhoto: Story = {
  args: { orientation: 'vertical', tone: 'float' },
  render: args => (
    <div
      className="relative h-48 w-16"
      style={{ background: 'linear-gradient(160deg, var(--dim), var(--accent))' }}
    >
      <TickScale {...args} />
    </div>
  ),
}

function DraggableScale() {
  const [value, setValue] = useState(0.5)
  const ref = useRef<HTMLDivElement>(null)
  const track = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect)
      return
    setValue(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)))
  }
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Demo scale"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)}%`}
      className="relative h-12 w-72 touch-none select-none border border-line bg-panel"
      style={{ cursor: 'ew-resize' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        track(e)
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0)
          track(e)
      }}
    >
      <TickScale ticks={nearTicks} value={value} orientation="horizontal" growth={0.6} />
    </div>
  )
}

/** The scale paints only, so interacting means being the caller: drag maps pointer x to `value`. */
export const Draggable: Story = {
  render: () => <DraggableScale />,
}
