import type { ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'
import { ArrowLeft, ChevronDown, CircleHelp, Download, FileText, FolderPlus, ImagePlus, LayoutGrid, LoaderCircle, Moon, SlidersHorizontal, Sun } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo, useRef, useSyncExternalStore } from 'react'
import { useT } from '../lib/i18n'
import { leafList } from '../lib/panes'
import { activeWs, useStore } from '../store'
import { isDarkSnapshot, subscribeTheme, toggleDark } from '../theme'
import { Button } from './ui/button'
import { Tip } from './ui/tip'

const triggerCls = 'inline-flex cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent px-2.5 text-[11.5px] text-dim transition-colors duration-[120ms] pointer-coarse:px-3 pointer-coarse:text-xs max-sm:px-3 max-sm:text-xs hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent data-popup-open:bg-chip-hover data-popup-open:text-txt'

const itemCls = 'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-1.5 text-xs text-txt outline-0 data-highlighted:bg-chip-hover active:bg-chip-on active:text-chip-on-txt data-disabled:cursor-default data-disabled:opacity-35'

// Right-aligned shortcut hint (and library count) inside a menu item.
const hintCls = 'ml-auto flex items-center gap-1.5 pl-4 text-[10px] tabular-nums text-faint'

const popupCls = 'min-w-[190px] rounded-none border border-line-strong bg-panel p-1 text-txt shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-[160ms] ease-(--ease-out) data-ending-style:duration-[120ms] data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]'

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

function TopBarActions({
  grid,
  toggleGrid,
  settingsOpen,
  onToggleSettings,
  busy,
  onExport,
  anyFilled,
  filled,
  dark,
}: {
  grid: boolean
  toggleGrid: () => void
  settingsOpen: boolean
  onToggleSettings: () => void
  busy: boolean
  onExport: () => void
  anyFilled: boolean
  filled: boolean
  dark: boolean
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-[5px]">
      {grid && (
        <Tip
          label={t('Back to editing · G')}
          trigger={(
            <Button variant="on" onClick={toggleGrid} aria-label={t('Back to editing')}>
              <MorphIcon icon={ImagePlus} size={15} strokeWidth={1.75} />
            </Button>
          )}
        />
      )}
      <Tip
        label={t('Settings · Shortcut: ,')}
        trigger={(
          <Button
            variant={settingsOpen ? 'on' : 'flat'}
            onClick={onToggleSettings}
            aria-label={t('Settings · Shortcut: ,')}
          >
            <MorphIcon icon={SlidersHorizontal} size={15} strokeWidth={1.75} />
            <span className="pointer-coarse:hidden max-sm:hidden">{t('Settings')}</span>
          </Button>
        )}
      />
      <Tip
        label={grid ? t('Export every non-empty workspace · ⌘E') : t('Export image · ⌘E')}
        trigger={(
          <Button
            variant="strong"
            onClick={onExport}
            disabled={busy || (grid ? !anyFilled : !filled)}
            aria-label={t('Export image')}
          >
            <MorphIcon
              icon={busy ? LoaderCircle : Download}
              size={15}
              strokeWidth={1.75}
              className={busy ? 'animate-spin [animation-duration:900ms]' : undefined}
            />
            <span className="pointer-coarse:hidden max-sm:hidden">{busy ? t('Rendering') : t('Export')}</span>
          </Button>
        )}
      />
      <Tip
        label={dark ? t('Switch to light theme') : t('Switch to dark theme')}
        trigger={(
          <Button
            onClick={toggleDark}
            aria-label={dark ? t('Switch to light theme') : t('Switch to dark theme')}
          >
            <MorphIcon icon={dark ? Sun : Moon} size={15} strokeWidth={1.75} />
          </Button>
        )}
      />
    </div>
  )
}

/**
 * The top chrome: the back-to-grid button plus the category menus (photo /
 * help) on the left, and the settings, export and theme actions on the right
 * (in grid view the left button becomes "back to editing"). In grid view the
 * photo menu is cut down to library-less navigation (the grid is a pure
 * overview), and export goes batch-mode.
 */
export function TopBar({
  busy,
  settingsOpen,
  onToggleLib,
  onToggleSettings,
  onToggleHelp,
  onExport,
  onCrops,
  onClearAsk,
}: {
  busy: boolean
  settingsOpen: boolean
  onToggleLib: () => void
  onToggleSettings: () => void
  onToggleHelp: () => void
  onExport: () => void
  onCrops: () => void
  onClearAsk: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  const photos = useStore(s => s.photos.length)
  const view = useStore(s => s.view)
  const root = useStore(s => activeWs(s).root)
  const anyFilled = useStore(s =>
    s.workspaces.some(w => leafList(w.root).some(l => l.photoId)))
  const toggleGrid = useStore(s => s.toggleGrid)
  const t = useT()
  const dark = useSyncExternalStore(subscribeTheme, isDarkSnapshot)
  const grid = view === 'grid'
  const filled = useMemo(() => leafList(root).some(l => l.photoId), [root])

  return (
    <header className="relative z-40 flex h-[var(--statusH)] flex-none items-stretch border-b border-line bg-statusbar px-1.5">
      {!grid && (
        <Tip
          label={t('Back to the grid · G')}
          trigger={(
            <Button onClick={toggleGrid} aria-label={t('Back to the grid')}>
              <MorphIcon icon={ArrowLeft} size={15} strokeWidth={1.75} />
              <span className="pointer-coarse:hidden max-sm:hidden">{t('Grid')}</span>
            </Button>
          )}
        />
      )}

      {grid
        ? (
          // Grid view is pure navigation: Help only (crop report is an
          // editing aid, library tools are hidden).
            <CatMenu label={t('Help')}>
              <Menu.Item className={itemCls} onClick={onToggleHelp}>
                <MorphIcon icon={CircleHelp} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Keyboard shortcuts')}
                <span className={hintCls}>?</span>
              </Menu.Item>
            </CatMenu>
          )
        : (
            <CatMenu label={t('Photo')}>
              <Menu.Item className={itemCls} onClick={() => fileRef.current?.click()}>
                <MorphIcon icon={ImagePlus} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Add photos…')}
              </Menu.Item>
              <Menu.Item className={itemCls} onClick={() => dirRef.current?.click()}>
                <MorphIcon icon={FolderPlus} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Add folder…')}
              </Menu.Item>
              <Menu.Item className={itemCls} onClick={onToggleLib}>
                <MorphIcon icon={LayoutGrid} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Library')}
                <span className={hintCls}>
                  {photos ? `${photos} · ` : ''}
                  I
                </span>
              </Menu.Item>
              <Menu.Separator className="mx-1 my-1 h-px border-0 bg-line" />
              <Menu.Item
                className={itemCls}
                onClick={onClearAsk}
                disabled={!photos}
              >
                <MorphIcon icon={FileText} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Clear library…')}
              </Menu.Item>
            </CatMenu>
          )}

      {!grid && (
        <CatMenu label={t('Help')}>
          <Menu.Item className={itemCls} onClick={onToggleHelp}>
            <MorphIcon icon={CircleHelp} size={13} strokeWidth={1.75} className="flex text-dim" />
            {t('Keyboard shortcuts')}
            <span className={hintCls}>?</span>
          </Menu.Item>
          <Menu.Item className={itemCls} onClick={onCrops}>
            <MorphIcon icon={FileText} size={13} strokeWidth={1.75} className="flex text-dim" />
            {t('Crop report')}
            <span className={hintCls}>C</span>
          </Menu.Item>
        </CatMenu>
      )}

      <span className="flex-1" />

      <TopBarActions
        grid={grid}
        toggleGrid={toggleGrid}
        settingsOpen={settingsOpen}
        onToggleSettings={onToggleSettings}
        busy={busy}
        onExport={onExport}
        anyFilled={anyFilled}
        filled={filled}
        dark={dark}
      />

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
