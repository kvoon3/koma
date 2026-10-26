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

/** The value control re-seeds the bridge through the story key, so dragging the slider stays live. */
function RangePlay({ value = 42, label = 'Scale', text = '42%', min = 0, max = 100, step = 1 }: {
  value?: number
  label?: string
  text?: string
  min?: number
  max?: number
  step?: number
}) {
  const [v, setV] = useState(value)
  return <RangeField label={label} text={text} value={v} min={min} max={max} step={step} onChange={setV} />
}

const meta = {
  title: 'UI/Fields',
  component: RangeField,
  tags: ['autodocs'],
  args: { label: 'Scale', text: '42%', value: 42, min: 0, max: 100, step: 1, onChange: undefined },
  render: args => (
    <div className="w-80">
      <RangePlay key={args.value} label={args.label} text={args.text} value={args.value} min={args.min} max={args.max} step={args.step} />
    </div>
  ),
} satisfies Meta<typeof RangeField>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  argTypes: {
    label: { control: 'text' },
    text: { control: 'text' },
    value: { control: 'number', min: 0, max: 100 },
    min: { control: 'number' },
    max: { control: 'number' },
    step: { control: 'number', min: 1, max: 25 },
    onChange: { control: false },
  },
}

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
