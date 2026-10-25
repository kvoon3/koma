import type { Meta, StoryObj } from '@storybook/react-vite'
import { Menu } from '@base-ui/react/menu'
import { Copy, Download, Trash2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { Button } from './button'
import { menuDangerItemCls, menuGroupLabelCls, MenuHint, menuItemCls, menuPopupCls, menuSeparatorCls } from './menu'

function MenuDemo() {
  return (
    <Menu.Root defaultOpen>
      <Menu.Trigger render={<Button variant="strong">Photo</Button>} />
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} className="z-[260] select-none outline-0">
          <Menu.Popup className={menuPopupCls}>
            <Menu.Group>
              <Menu.GroupLabel className={menuGroupLabelCls}>This photo</Menu.GroupLabel>
              <Menu.Item className={menuItemCls}>
                <MorphIcon icon={Download} size={13} strokeWidth={1.75} className="text-dim" />
                Save photo
                <MenuHint>⌘S</MenuHint>
              </Menu.Item>
              <Menu.Item className={menuItemCls}>
                <MorphIcon icon={Copy} size={13} strokeWidth={1.75} className="text-dim" />
                Duplicate
                <MenuHint>⌘D</MenuHint>
              </Menu.Item>
            </Menu.Group>
            <Menu.Separator className={menuSeparatorCls} />
            <Menu.Item className={menuDangerItemCls}>
              <MorphIcon icon={Trash2} size={13} strokeWidth={1.75} />
              Delete
              <MenuHint>⌫</MenuHint>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

const meta = {
  title: 'UI/Menu',
  tags: ['autodocs'],
  component: MenuDemo,
} satisfies Meta<typeof MenuDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}
