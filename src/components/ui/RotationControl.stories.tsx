import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { degToRad } from '../../lib/detent'
import { RotationControl } from './RotationControl'

const noop = () => undefined

function DialPlay({ value = 0, label = 'Rotation', disabled = false }: {
  value?: number
  label?: string
  disabled?: boolean
}) {
  const [rad, setRad] = useState(value)
  return (
    <div className="w-72">
      <RotationControl value={rad} onChange={setRad} label={label} disabled={disabled} />
    </div>
  )
}

const meta = {
  title: 'UI/RotationControl',
  component: RotationControl,
  tags: ['autodocs'],
  args: { value: 0, label: 'Rotation', disabled: false, onChange: noop },
  render: args => <DialPlay key={args.value} value={degToRad(args.value)} label={args.label} disabled={args.disabled} />,
} satisfies Meta<typeof RotationControl>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  argTypes: {
    value: { control: 'number', min: -180, max: 180, step: 1 },
    label: { control: 'text' },
    disabled: { control: 'boolean' },
    onChange: { control: false },
  },
}

export const Turned: Story = {
  render: () => <DialPlay value={Math.PI / 3} />,
}

export const Disabled: Story = {
  render: () => <DialPlay disabled />,
}
