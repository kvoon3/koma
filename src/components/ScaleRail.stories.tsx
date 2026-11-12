import type { Meta, StoryObj } from '@storybook/react-vite'
import { ScaleRail } from './ScaleRail'

const meta = {
  title: 'UI/ScaleRail',
  component: ScaleRail,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  render: () => (
    <div
      className="relative h-[420px] w-40 overflow-hidden"
      style={{ background: 'linear-gradient(160deg, var(--dim), var(--accent))' }}
    >
      <ScaleRail />
    </div>
  ),
} satisfies Meta<typeof ScaleRail>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
