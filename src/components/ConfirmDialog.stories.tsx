import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConfirmDialog } from './ConfirmDialog'

const noop = () => undefined

const meta = {
  title: 'UI/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  args: { open: true, onClose: noop, onConfirm: noop },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Confirm: Story = {
  args: {
    title: 'Add photos?',
    description: 'The six selected photos join the library and the current board.',
    confirmLabel: 'Add',
  },
}

export const Danger: Story = {
  args: {
    title: 'Clear library?',
    description: 'This removes all imported photos and resets all workspaces to blank canvases. This cannot be undone.',
    confirmLabel: 'Clear all',
    danger: true,
  },
}
