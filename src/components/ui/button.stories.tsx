import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowLeft, Camera, Download, Redo2, Undo2 } from 'lucide'
import { Button } from './button'

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
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
      <Button variant="float" icon={Camera} iconSize={15} aria-label="Snapshot" />
      <Button variant="ghost" icon={Undo2} iconSize={15} aria-label="Undo" />
      <Button disabled>Disabled</Button>
    </div>
  ),
}

export const Icon: Story = {
  render: () => <Button icon={Download}>Export</Button>,
}

export const Loading: Story = {
  render: () => <Button icon={Download} loading>Export</Button>,
}

export const Float: Story = {
  render: () => (
    <div className="flex items-center gap-1.5">
      <Button variant="float" icon={Camera} iconSize={15} aria-label="Snapshot the board" />
      <Button variant="float" icon={Camera} iconSize={15} loading aria-label="Snapshotting the board" />
    </div>
  ),
}

/** The float row's chrome (FloatActions): the float chip's ghost. */
export const Ghost: Story = {
  render: () => (
    <div className="flex items-center gap-1.5">
      <Button variant="ghost" icon={ArrowLeft} iconSize={15} aria-label="Back to the grid" />
      <Button variant="ghost" icon={Undo2} iconSize={15} aria-label="Undo" />
      <Button variant="ghost" icon={Redo2} iconSize={15} aria-label="Redo" />
      <Button variant="ghost" icon={Undo2} iconSize={15} disabled aria-label="Nothing to undo" />
    </div>
  ),
}
