import type { Meta, StoryObj } from '@storybook/react-vite'
import { BrandMark } from './BrandMark'

const meta = {
  title: 'UI/BrandMark',
  component: BrandMark,
  tags: ['autodocs'],
  args: { className: 'h-4 w-4 flex-none text-txt' },
} satisfies Meta<typeof BrandMark>

export default meta
type Story = StoryObj<typeof meta>

export const TopBar: Story = {
  render: args => (
    <div className="flex h-11 w-64 items-center gap-2 bg-panel px-3">
      <BrandMark {...args} />
      <span className="font-brand text-base leading-none font-bold text-txt">koma</span>
    </div>
  ),
}

export const Large: Story = {
  args: { className: 'h-12 w-12 text-txt' },
}
