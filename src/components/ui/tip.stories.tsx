import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowLeft, Redo2, Undo2 } from 'lucide'
import { Button } from './button'
import { Tip } from './tip'

const meta = {
  title: 'UI/Tip',
  tags: ['autodocs'],
  render: () => (
    <Tip
      label="Back to the grid · G"
      trigger={<Button variant="float" icon={ArrowLeft} iconSize={15} aria-label="Back to the grid" />}
    />
  ),
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const OnIconButton: Story = {}

/** The popup, pinned open so a static page shows what the hover gives. */
export const Open: Story = {
  render: () => (
    <div className="flex h-24 items-end justify-center">
      <Tip
        label="Back to the grid · G"
        defaultOpen
        trigger={<Button variant="float" icon={ArrowLeft} iconSize={15} aria-label="Back to the grid" />}
      />
    </div>
  ),
}

export const Row: Story = {
  render: () => (
    <div className="flex gap-1.5">
      <Tip
        label="Undo · ⌘Z"
        trigger={<Button variant="float" icon={Undo2} iconSize={15} aria-label="Undo" />}
      />
      <Tip
        label="Redo · ⌘⇧Z"
        trigger={<Button variant="float" icon={Redo2} iconSize={15} aria-label="Redo" />}
      />
    </div>
  ),
}
