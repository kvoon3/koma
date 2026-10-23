import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './button'
import { NamePrompt } from './NamePrompt'

function PromptDemo({ initial = '', error = null }: { initial?: string, error?: string | null }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      {!open && (
        <Button variant="strong" onClick={() => setOpen(true)}>
          Reopen
        </Button>
      )}
      <NamePrompt
        open={open}
        title="New folder"
        initial={initial}
        confirmLabel="Create"
        error={error}
        field="folder"
        placeholder="Folder name"
        maxLength={40}
        onSubmit={() => true}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

const meta = {
  title: 'UI/NamePrompt',
  render: () => <PromptDemo />,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const NewFolder: Story = {}

export const RefusedName: Story = {
  render: () => <PromptDemo initial="Summer" error="That name is taken." />,
}
