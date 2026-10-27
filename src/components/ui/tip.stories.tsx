import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowLeft, Redo2, Undo2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { Tip } from './tip'

const iconBtnCls = 'grid h-[30px] w-[30px] cursor-pointer place-items-center border border-float-line bg-float-bg text-float-icon backdrop-blur-[7px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent'

const meta = {
  title: 'UI/Tip',
  tags: ['autodocs'],
  render: () => (
    <Tip
      label="Back to the grid · G"
      trigger={(
        <button type="button" className={iconBtnCls} aria-label="Back to the grid">
          <MorphIcon icon={ArrowLeft} size={15} strokeWidth={1.75} />
        </button>
      )}
    />
  ),
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const OnIconButton: Story = {}

export const Row: Story = {
  render: () => (
    <div className="flex gap-1.5">
      <Tip
        label="Undo · ⌘Z"
        trigger={(
          <button type="button" className={iconBtnCls} aria-label="Undo">
            <MorphIcon icon={Undo2} size={15} strokeWidth={1.75} />
          </button>
        )}
      />
      <Tip
        label="Redo · ⌘⇧Z"
        trigger={(
          <button type="button" className={iconBtnCls} aria-label="Redo">
            <MorphIcon icon={Redo2} size={15} strokeWidth={1.75} />
          </button>
        )}
      />
    </div>
  ),
}
