import type { Meta, StoryObj } from '@storybook/react-vite'
import { Spinner } from './spinner'

const meta = {
  title: 'UI/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  args: { size: 13, strokeWidth: 1.75 },
  argTypes: {
    size: { control: 'number', min: 10, max: 32, step: 1 },
    strokeWidth: { control: 'number', min: 0.5, max: 3, step: 0.25 },
    className: { control: 'text' },
  },
} satisfies Meta<typeof Spinner>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
