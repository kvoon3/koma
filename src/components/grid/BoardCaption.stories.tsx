import type { Meta, StoryObj } from '@storybook/react-vite'
import { BoardCaption } from './BoardCaption'

const noop = () => undefined

const meta = {
  title: 'Grid/BoardCaption',
  component: BoardCaption,
  args: {
    width: 360,
    height: 44,
    snapshotDisabled: false,
    snapshotBusy: false,
    onOpenSwitcher: noop,
    onSnapshot: noop,
  },
} satisfies Meta<typeof BoardCaption>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {}

export const Busy: Story = {
  args: { snapshotBusy: true },
}

export const Disabled: Story = {
  args: { snapshotDisabled: true },
}
