import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { RotationControl } from './RotationControl'

function DialDemo({ initial = 0, disabled = false }: { initial?: number, disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="w-72">
      <RotationControl value={value} onChange={setValue} label="Rotation" disabled={disabled} />
    </div>
  )
}

const meta = {
  title: 'UI/RotationControl',
  render: () => <DialDemo />,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Upright: Story = {}

export const Turned: Story = {
  render: () => <DialDemo initial={Math.PI / 3} />,
}

export const Disabled: Story = {
  render: () => <DialDemo disabled />,
}
