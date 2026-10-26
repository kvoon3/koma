import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { Button } from './ui/button'

const noop = () => undefined

/** The `open` control re-seeds the bridge through the story key; args re-render in place. */
function ConfirmPlay({ open = true, title = '', description = '', confirmLabel = '', danger = false }: {
  open?: boolean
  title?: string
  description?: string
  confirmLabel?: string
  danger?: boolean
}) {
  const [shown, setShown] = useState(open)
  return (
    <>
      {!shown && (
        <Button variant="strong" onClick={() => setShown(true)}>
          Reopen
        </Button>
      )}
      <ConfirmDialog
        open={shown}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        danger={danger}
        onClose={() => setShown(false)}
        onConfirm={() => setShown(false)}
      />
    </>
  )
}

const meta = {
  title: 'UI/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  args: { open: true, onClose: noop, onConfirm: noop },
  argTypes: {
    open: { control: 'boolean' },
    title: { control: 'text' },
    description: { control: 'text' },
    confirmLabel: { control: 'text' },
    danger: { control: 'boolean' },
    onClose: { control: false },
    onConfirm: { control: false },
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  args: {
    open: true,
    title: 'Delete photo?',
    description: 'The photo leaves the library and every board it sits on.',
    confirmLabel: 'Delete',
    danger: false,
  },
  render: args => (
    <ConfirmPlay
      key={String(args.open)}
      open={args.open}
      title={args.title}
      description={args.description}
      confirmLabel={args.confirmLabel}
      danger={args.danger}
    />
  ),
}

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
