import type { Meta, StoryObj } from '@storybook/react-vite'
import { DeleteZone } from './DeleteZone'

const meta = {
  title: 'UI/DeleteZone',
  component: DeleteZone,
  tags: ['autodocs'],
  args: { label: 'Drop here to delete', active: true, over: false },
  render: args => (
    <div className="w-[520px] border border-line">
      <div className="flex h-11 items-center border-b border-line bg-panel px-3 text-xs text-dim">koma</div>
      <div className="relative h-64 bg-canvas">
        <DeleteZone {...args} />
      </div>
    </div>
  ),
} satisfies Meta<typeof DeleteZone>

export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {}

export const DragOver: Story = {
  args: { over: true },
}
