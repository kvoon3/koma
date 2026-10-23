import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ScaleMark } from './TickScale'
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
  args: { ticks: nearTicks, value: 0.5, orientation: 'horizontal', tone: 'panel' },
  render: args => (
    <div className="relative h-12 w-72 border border-line bg-panel">
      <TickScale {...args} />
    </div>
  ),
} satisfies Meta<typeof TickScale>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: args => (
    <div className="relative h-48 w-16 border border-line bg-panel">
      <TickScale {...args} />
    </div>
  ),
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
