import type { Meta, StoryObj } from '@storybook/react-vite'
import type { IconNode } from 'lucide'
import type { ComponentProps, ComponentType } from 'react'
import { ArrowLeft, Camera, Download, Plus, Redo2, Undo2 } from 'lucide'
import { Button } from './button'

const ICONS = { Download, Camera, Undo2, ArrowLeft, Plus }
type IconName = keyof typeof ICONS

type ButtonArgs = Omit<ComponentProps<typeof Button>, 'icon'> & { icon?: IconNode | IconName }

const meta = {
  title: 'UI/Button',
  // One assertion, not a chain: Button's own props fit inside ButtonArgs (its
  // `icon` narrows to IconNode), so the docs table still documents the real
  // Button while the control stores the name.
  component: Button as ComponentType<ButtonArgs>,
  tags: ['autodocs'],
  render: args => (
    <div className="flex h-16 items-center">
      <Button
        {...args}
        icon={typeof args.icon === 'string' ? ICONS[args.icon as IconName] : args.icon}
      />
    </div>
  ),
} satisfies Meta<ButtonArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  args: {
    children: 'Export',
    variant: 'flat',
    icon: 'Download',
    iconSize: 13,
    loading: false,
    disabled: false,
  },
  argTypes: {
    variant: { control: 'select', options: ['flat', 'on', 'strong', 'close', 'danger', 'float'] },
    icon: { control: 'select', options: Object.keys(ICONS) },
    iconSize: { control: 'number', min: 10, max: 24, step: 1 },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
    children: { control: 'text' },
    type: { control: false },
    className: { control: false },
    ref: { control: false },
    onClick: { control: false },
  },
}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Flat</Button>
      <Button variant="on">Selected</Button>
      <Button variant="strong">Strong</Button>
      <Button variant="close" aria-label="Close">Close</Button>
      <Button variant="danger">Delete</Button>
      <Button variant="float" icon={Camera} iconSize={15} aria-label="Snapshot" />
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
      <Button variant="float" icon={ArrowLeft} iconSize={15} aria-label="Back to the grid" />
      <Button variant="float" icon={Undo2} iconSize={15} aria-label="Undo" />
      <Button variant="float" icon={Redo2} iconSize={15} aria-label="Redo" />
      <Button variant="float" icon={Camera} iconSize={15} aria-label="Snapshot the board" />
      <Button variant="float" icon={Camera} iconSize={15} loading aria-label="Snapshotting the board" />
      <Button variant="float" icon={Undo2} iconSize={15} disabled aria-label="Nothing to undo" />
    </div>
  ),
}
