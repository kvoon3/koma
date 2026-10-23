import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ColorField, RangeField, SegmentedField, SelectField } from './field'

const fitItems = [
  { value: 'fit', label: 'Fit' },
  { value: 'fill', label: 'Fill' },
] as const

const viewItems = [
  { value: 'grid', label: 'Grid' },
  { value: 'canvas', label: 'Canvas' },
]

function RangeDemo() {
  const [value, setValue] = useState(42)
  return (
    <div className="w-80">
      <RangeField label="Scale" text={`${value}%`} value={value} max={100} onChange={setValue} />
    </div>
  )
}

function SegmentedDemo() {
  const [value, setValue] = useState<'fit' | 'fill'>('fit')
  return (
    <div className="w-80">
      <SegmentedField label="Fit" value={value} items={fitItems} onChange={setValue} />
    </div>
  )
}

function SelectDemo() {
  const [value, setValue] = useState('grid')
  return (
    <div className="w-80">
      <SelectField label="View" value={value} items={viewItems} onChange={setValue} />
    </div>
  )
}

function ColorDemo() {
  const [value, setValue] = useState('#171717')
  return (
    <div className="w-80">
      <ColorField label="Frame" value={value} onChange={setValue} />
    </div>
  )
}

const meta = {
  title: 'UI/Fields',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Range: Story = {
  render: () => <RangeDemo />,
}

export const Segmented: Story = {
  render: () => <SegmentedDemo />,
}

export const Select: Story = {
  render: () => <SelectDemo />,
}

export const Color: Story = {
  render: () => <ColorDemo />,
}
