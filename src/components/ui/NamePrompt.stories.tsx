import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './button'
import { NamePrompt } from './NamePrompt'

const noop = () => undefined

/** The `open` control re-seeds the bridge through the story key; args re-render in place. */
function PromptPlay({ open = true, title = 'New folder', initial = '', confirmLabel = 'Create', error = null, field = 'folder', placeholder = 'Folder name', maxLength = 40 }: {
  open?: boolean
  title?: string
  initial?: string
  confirmLabel?: string
  error?: string | null
  field?: 'folder' | 'tag'
  placeholder?: string
  maxLength?: number
}) {
  const [shown, setShown] = useState(open)
  return (
    <>
      {!shown && (
        <Button variant="strong" onClick={() => setShown(true)}>
          Reopen
        </Button>
      )}
      <NamePrompt
        open={shown}
        title={title}
        initial={initial}
        confirmLabel={confirmLabel}
        error={error}
        field={field}
        placeholder={placeholder}
        maxLength={maxLength}
        onSubmit={() => true}
        onClose={() => setShown(false)}
      />
    </>
  )
}

const meta = {
  title: 'UI/NamePrompt',
  component: NamePrompt,
  tags: ['autodocs'],
  args: {
    open: true,
    title: 'New folder',
    initial: '',
    confirmLabel: 'Create',
    error: null,
    field: 'folder' as const,
    placeholder: 'Folder name',
    maxLength: 40,
    onSubmit: () => true,
    onClose: noop,
  },
  render: args => (
    <PromptPlay
      key={String(args.open)}
      open={args.open}
      title={args.title}
      initial={args.initial}
      confirmLabel={args.confirmLabel}
      error={args.error ?? null}
      field={args.field}
      placeholder={args.placeholder}
      maxLength={args.maxLength}
    />
  ),
} satisfies Meta<typeof NamePrompt>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  argTypes: {
    open: { control: 'boolean' },
    title: { control: 'text' },
    initial: { control: 'text' },
    confirmLabel: { control: 'text' },
    error: { control: 'text' },
    field: { control: 'select', options: ['folder', 'tag'] },
    placeholder: { control: 'text' },
    maxLength: { control: 'number', min: 1, max: 80 },
    onSubmit: { control: false },
    onClose: { control: false },
  },
}

export const RefusedName: Story = {
  render: () => <PromptPlay initial="Summer" error="That name is taken." />,
}
