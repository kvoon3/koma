import type { Meta, StoryObj } from '@storybook/react-vite'
import { ViewZoomChip } from './ViewZoomChip'

const noop = () => undefined

const meta = {
  title: 'UI/ViewZoomChip',
  component: ViewZoomChip,
  tags: ['autodocs'],
  args: { scale: 1.6, onFit: noop },
  render: args => (
    <div
      className="relative h-24 w-72 border border-line"
      style={{ background: 'linear-gradient(160deg, var(--dim), var(--accent))' }}
    >
      <ViewZoomChip {...args} className="absolute left-2.5 top-2.5" />
    </div>
  ),
} satisfies Meta<typeof ViewZoomChip>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  argTypes: {
    scale: { control: 'number', min: 0.25, max: 3, step: 0.05 },
    onFit: { control: false },
    className: { control: false },
  },
}
