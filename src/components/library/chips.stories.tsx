import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { chipCls, chipOffCls, chipOnCls, countCls } from './chips'

function Chip({ on = false, children }: { on?: boolean, children: ReactNode }) {
  return <button type="button" className={`${chipCls} ${on ? chipOnCls : chipOffCls}`}>{children}</button>
}

/**
 * The real chips are class strings, not a component, so the docs mount this
 * stand-in that wears them. It carries only `on` and the label; `countCls`
 * styles the trailing count in the Row story.
 */
const meta = {
  title: 'Library/Chips',
  component: Chip,
  tags: ['autodocs'],
  args: { children: 'Stickers' },
} satisfies Meta<typeof Chip>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  argTypes: {
    on: { control: 'boolean' },
    children: { control: 'text' },
  },
}

export const On: Story = {
  args: { on: true },
}

export const Row: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip on>
        All
        {' '}
        <span className={countCls}>12</span>
      </Chip>
      <Chip>
        Photos
        {' '}
        <span className={countCls}>8</span>
      </Chip>
      <Chip>
        Music
        {' '}
        <span className={countCls}>4</span>
      </Chip>
    </div>
  ),
}
