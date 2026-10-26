import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { toastManager } from '../lib/toast'
import ToastHost from './ToastHost'

/** A timeout of 0 keeps the stack up for a review pass instead of dismissing it. */
const TOASTS = [
  { title: 'Workspace saved', description: 'The board file is in your downloads.' },
  { title: 'Library cleared' },
  { title: 'Export failed: no image files found', description: 'Add a photo to the board first.' },
] as const

function ToastDemo() {
  useEffect(() => {
    const ids = TOASTS.map(toast => toastManager.add({ ...toast, timeout: 0 }))
    return () => ids.forEach(id => toastManager.close(id))
  }, [])
  return <ToastHost />
}

/**
 * ToastHost takes no props: the stack lives in the shared `toastManager`, and
 * the app pushes toasts through it (`say`). The docs page can show the stack
 * but has nothing for a Controls row to drive.
 */
const meta = {
  title: 'UI/ToastHost',
  component: ToastHost,
  tags: ['autodocs'],
  render: () => <ToastDemo />,
} satisfies Meta<typeof ToastHost>

export default meta
type Story = StoryObj<typeof meta>

export const Stack: Story = {}
