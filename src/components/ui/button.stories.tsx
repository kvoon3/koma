import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'

const meta = {
  title: 'UI/Button',
  component: Button,
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Flat</Button>
      <Button variant="on">Selected</Button>
      <Button variant="strong">Strong</Button>
      <Button variant="close" aria-label="Close">Close</Button>
      <Button variant="danger">Delete</Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
}
