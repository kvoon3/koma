import type { ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'
import { ChevronDown, CircleHelp, Download, FileText, FolderPlus, ImagePlus, LayoutGrid, LoaderCircle, Moon, SlidersHorizontal, Sun } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo, useRef, useSyncExternalStore } from 'react'
import { leafList } from '../lib/panes'
import { useStore } from '../store'
import { isDarkSnapshot, subscribeTheme, toggleDark } from '../theme'
import { Button } from './ui/button'
import { Tip } from './ui/tip'

const triggerCls = 'inline-flex cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent px-2.5 text-[11.5px] text-dim transition-colors duration-[120ms] pointer-coarse:px-3 pointer-coarse:text-xs hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent data-popup-open:bg-chip-hover data-popup-open:text-txt'

const itemCls = 'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-1.5 text-xs text-txt outline-0 data-highlighted:bg-chip-hover active:bg-chip-on active:text-chip-on-txt data-disabled:cursor-default data-disabled:opacity-35'

// Right-aligned shortcut hint (and library count) inside a menu item.
const hintCls = 'ml-auto flex items-center gap-1.5 pl-4 text-[10px] tabular-nums text-faint'

const popupCls = 'min-w-[190px] rounded-none border border-line-strong bg-panel p-1 text-txt shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-100 ease-out data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]'

function CatMenu({ label, children }: { label: string, children: ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={triggerCls}>
        {label}
        <MorphIcon icon={ChevronDown} size={12} strokeWidth={1.75} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="z-[260] select-none outline-0">
          <Menu.Popup className={popupCls}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/**
 * The top chrome: the category menus (photo / help) on the left, and the
 * settings, export and theme actions on the right.
 */
export function TopBar({
  busy,
  settingsOpen,
  onToggleLib,
  onToggleSettings,
  onToggleHelp,
  onExport,
  onCrops,
}: {
  busy: boolean
  settingsOpen: boolean
  onToggleLib: () => void
  onToggleSettings: () => void
  onToggleHelp: () => void
  onExport: () => void
  onCrops: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  const photos = useStore(s => s.photos.length)
  const root = useStore(s => s.root)
  const dark = useSyncExternalStore(subscribeTheme, isDarkSnapshot)
  const filled = useMemo(() => leafList(root).some(l => l.photoId), [root])

  return (
    <header className="relative z-40 flex h-[var(--statusH)] flex-none items-stretch border-b border-line bg-statusbar px-1.5">
      <CatMenu label="Photo">
        <Menu.Item className={itemCls} onClick={() => fileRef.current?.click()}>
          <MorphIcon icon={ImagePlus} size={13} strokeWidth={1.75} className="flex text-dim" />
          Add photos…
        </Menu.Item>
        <Menu.Item className={itemCls} onClick={() => dirRef.current?.click()}>
          <MorphIcon icon={FolderPlus} size={13} strokeWidth={1.75} className="flex text-dim" />
          Add folder…
        </Menu.Item>
        <Menu.Item className={itemCls} onClick={onToggleLib}>
          <MorphIcon icon={LayoutGrid} size={13} strokeWidth={1.75} className="flex text-dim" />
          Library
          <span className={hintCls}>
            {photos ? `${photos} · ` : ''}
            I
          </span>
        </Menu.Item>
      </CatMenu>

      <CatMenu label="Help">
        <Menu.Item className={itemCls} onClick={onToggleHelp}>
          <MorphIcon icon={CircleHelp} size={13} strokeWidth={1.75} className="flex text-dim" />
          Keyboard shortcuts
          <span className={hintCls}>?</span>
        </Menu.Item>
        <Menu.Item className={itemCls} onClick={onCrops}>
          <MorphIcon icon={FileText} size={13} strokeWidth={1.75} className="flex text-dim" />
          Crop report
          <span className={hintCls}>C</span>
        </Menu.Item>
      </CatMenu>

      <span className="flex-1" />

      <div className="flex items-center gap-[5px]">
        <Tip
          label="Settings · Shortcut: ,"
          trigger={(
            <Button
              variant={settingsOpen ? 'on' : 'flat'}
              onClick={onToggleSettings}
              aria-label="Settings · Shortcut: ,"
            >
              <MorphIcon icon={SlidersHorizontal} size={15} strokeWidth={1.75} />
              <span className="pointer-coarse:hidden max-sm:hidden">Settings</span>
            </Button>
          )}
        />
        <Tip
          label="Export image · ⌘E"
          trigger={(
            <Button
              variant="strong"
              onClick={onExport}
              disabled={busy || !filled}
              aria-label="Export image"
            >
              <MorphIcon
                icon={busy ? LoaderCircle : Download}
                size={15}
                strokeWidth={1.75}
                className={busy ? 'animate-spin [animation-duration:900ms]' : undefined}
              />
              <span className="pointer-coarse:hidden max-sm:hidden">{busy ? 'Rendering' : 'Export'}</span>
            </Button>
          )}
        />
        <Tip
          label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          trigger={(
            <Button
              onClick={toggleDark}
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              <MorphIcon icon={dark ? Sun : Moon} size={15} strokeWidth={1.75} />
            </Button>
          )}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif,.hif,.mov"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files)
            useStore.getState().addPhotos([...e.target.files])
          e.target.value = ''
        }}
      />
      <input
        ref={dirRef}
        type="file"
        hidden
        webkitdirectory=""
        onChange={(e) => {
          if (e.target.files)
            useStore.getState().addPhotos([...e.target.files])
          e.target.value = ''
        }}
      />
    </header>
  )
}
