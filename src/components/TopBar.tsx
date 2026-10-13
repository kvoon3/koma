import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import type { Lang } from '../lib/i18n'
import type { WorkspaceDocV1 } from '../lib/workspaceFile'
import { Menu } from '@base-ui/react/menu'
import { Menubar } from '@base-ui/react/menubar'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Check, ChevronDown, CircleHelp, Download, FileText, FolderOpen, FolderPlus, ImagePlus, Languages, LayoutGrid, LoaderCircle, Moon, Save, Settings, Sun } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { setLang, useLang, useT } from '../lib/i18n'
import { clearImageCaches } from '../lib/imageStore'
import { leafList } from '../lib/panes'
import { clearSession } from '../lib/sessionStore'
import { say } from '../lib/toast'
import { buildDoc, downloadDoc, parseWorkspaceFile } from '../lib/workspaceFile'
import { activeWs, useStore } from '../store'
import { isDarkSnapshot, subscribeTheme, toggleDark } from '../theme'
import { ConfirmDialog } from './ConfirmDialog'
import { Button, buttonBase, buttonVariants } from './ui/button'
import { Tip } from './ui/tip'

const triggerCls = 'inline-flex cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent px-2.5 text-[11.5px] text-dim transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] pointer-coarse:px-3 pointer-coarse:text-xs max-sm:px-3 max-sm:text-xs hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent data-popup-open:bg-chip-hover data-popup-open:text-txt'

const itemCls = 'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-1.5 text-xs text-txt outline-0 data-highlighted:bg-chip-hover active:bg-chip-on active:text-chip-on-txt data-disabled:cursor-default data-disabled:opacity-35'

// Right-aligned shortcut hint (and library count) inside a menu item.
const hintCls = 'ml-auto flex items-center gap-1.5 pl-4 text-[10px] tabular-nums text-faint'

// `data-instant` fires on menubar hand-offs: the incoming panel slides over from
// the trigger it left (no fade re-run), the outgoing one is gone at once.
const popupCls = 'min-w-[190px] rounded-none border border-line-strong bg-panel p-1 text-txt shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-(--dur-surface) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97] data-instant:transition-none data-instant:not-data-ending-style:animate-[menu-hop_var(--dur-surface)_var(--ease-out)]'

function CatMenu({ label, hop, onTriggerEnter, children }: { label: string, hop: number, onTriggerEnter: (e: MouseEvent<HTMLButtonElement>) => void, children: ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={triggerCls} onMouseEnter={onTriggerEnter}>
        {label}
        <MorphIcon icon={ChevronDown} size={12} strokeWidth={1.75} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="z-[260] select-none outline-0">
          <Menu.Popup className={popupCls} style={{ '--menu-hop': `${hop}px` } as CSSProperties}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/** The languages the interface ships in, in menu order. */
const LANG_ITEMS: [Lang, string][] = [
  ['en', 'English'],
  ['zh-Hans', '简体中文'],
  ['zh-Hant', '繁體中文'],
]

/**
 * The interface language, a two-row popup under the top bar next to the theme
 * toggle. It used to live in the settings drawer; a preference picked once in
 * a while belongs with the chrome, not behind a tab.
 */
function LangMenu() {
  const t = useT()
  const lang = useLang()
  return (
    <Menu.Root>
      <Tip
        label={t('Language')}
        trigger={(
          <Menu.Trigger
            className={`${buttonBase} ${buttonVariants.flat} data-popup-open:bg-chip-hover data-popup-open:text-txt`}
            aria-label={t('Language')}
          >
            <MorphIcon icon={Languages} size={15} strokeWidth={1.75} />
          </Menu.Trigger>
        )}
      />
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-[260] select-none outline-0">
          <Menu.Popup className={popupCls}>
            <Menu.RadioGroup value={lang} onValueChange={v => setLang(v as Lang)}>
              {LANG_ITEMS.map(([value, name]) => (
                <Menu.RadioItem key={value} className={itemCls} value={value} closeOnClick>
                  {name}
                  <Menu.RadioItemIndicator className="ml-auto flex pl-4 text-accent">
                    <MorphIcon icon={Check} size={12} strokeWidth={2} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function TopBarActions({
  grid,
  settingsOpen,
  onToggleSettings,
  busy,
  onExport,
  anyFilled,
  filled,
  dark,
}: {
  grid: boolean
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
      <Tip
        label={t('Settings · Shortcut: ,')}
        trigger={(
          <Button
            variant={settingsOpen ? 'on' : 'flat'}
            onClick={onToggleSettings}
            aria-label={t('Settings · Shortcut: ,')}
          >
            <MorphIcon icon={Settings} size={15} strokeWidth={1.75} />
            <span className="pointer-coarse:hidden max-sm:hidden">{t('Settings')}</span>
          </Button>
        )}
      />
      <Tip
        label={grid ? t('Export every non-empty workspace · ⌘E') : t('Export image · ⌘E')}
        trigger={(
          <Button
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
      <LangMenu />
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
 * The wordmark, left of the menus: the one piece of chrome that speaks in a face
 * of its own. The face is a 1.4 KB subset that ships with the bundle (see
 * assets/fonts/SOURCE.md), so it is painted in the first frame, offline, with no
 * CDN face to swap in later. The 1px lift puts it on the menus' baseline: a
 * centered line box drops the mincho's baseline 1px below the 11.5px system
 * text's, and the two read as one line only when those baselines agree. Below
 * `sm` the bar is down to the menus and four icon buttons, and the wordmark
 * stands aside.
 */
function Wordmark() {
  return (
    <span
      aria-hidden
      className="relative top-[-1px] mr-2 flex flex-none items-center font-brand text-base leading-none font-bold text-txt max-sm:hidden"
    >
      koma
    </span>
  )
}

/**
 * The top chrome: in edit view the category menus (workspace / photo /
 * help) on the left, and the settings, export and theme actions on the
 * right; the back-to-grid and reset-workspace buttons float under the top
 * bar instead (FloatActions). Grid view has no back button: click a cell (or
 * press G) to open a workspace. In grid view the photo menu is cut down to
 * library-less navigation (the grid is a pure overview) and export goes
 * batch-mode.
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
  const wsFileRef = useRef<HTMLInputElement>(null)

  const navigate = useNavigate()
  const grid = useRouterState({ select: s => s.location.pathname === '/' })

  const [saving, setSaving] = useState(false)
  /** Parsed doc awaiting the replace-current-board confirm. */
  const [openDoc, setOpenDoc] = useState<{ doc: WorkspaceDocV1, photos: ReturnType<typeof useStore.getState>['photos'] } | null>(null)

  const prevTriggerXRef = useRef<number | null>(null)
  const [hop, setHop] = useState(0)

  // Menus hand over on hover: remember how far the incoming panel has to travel
  // (the gap between the trigger it left and the one it lands on).
  const onTriggerEnter = (e: MouseEvent<HTMLButtonElement>) => {
    const x = e.currentTarget.getBoundingClientRect().left
    setHop((prevTriggerXRef.current ?? x) - x)
    prevTriggerXRef.current = x
  }

  const photos = useStore(s => s.photos.length)
  const root = useStore(s => activeWs(s).root)
  const anyFilled = useStore(s =>
    s.workspaces.some(w => leafList(w.root).some(l => l.photoId)))
  const t = useT()
  const dark = useSyncExternalStore(subscribeTheme, isDarkSnapshot)
  const filled = useMemo(() => leafList(root).some(l => l.photoId), [root])

  const doSaveFile = async () => {
    setSaving(true)
    say(t('Saving workspace file…'))
    try {
      downloadDoc(await buildDoc(useStore.getState()))
      say(t('Workspace file saved'))
    }
    catch (e) {
      say(t('Failed to save workspace: {msg}', { msg: (e as Error).message }))
    }
    finally {
      setSaving(false)
    }
  }

  const applyOpened = () => {
    if (!openDoc)
      return
    const { doc, photos } = openDoc
    // Same reset semantics as clearLibrary: old previews (keyed by photo id)
    // and the old autosaved session must not survive the replaced board.
    clearImageCaches()
    void clearSession()
    useStore.setState({
      photos,
      workspaces: doc.workspaces,
      activeId: doc.workspaces.some(w => w.id === doc.activeId) ? doc.activeId : doc.workspaces[0].id,
      gap: doc.settings.gap,
      radius: doc.settings.radius,
      bg: doc.settings.bg,
      longSide: doc.settings.longSide,
      format: doc.settings.format,
      quality: doc.settings.quality,
      labelSel: null,
      stickerSel: null,
      labelEditReq: null,
      // The clipboard and the sticker maker point at the replaced board.
      paneClip: null,
      stickerMakerFor: null,
    })
    setOpenDoc(null)
    say(t('Workspace opened'))
    void navigate({ to: '/' })
  }

  return (
    <header className="app-titlebar relative z-40 flex h-[var(--statusH)] flex-none items-stretch border-b border-line bg-statusbar">
      <Wordmark />
      {/* The menubar is what makes a click-opened menu hand over to the next
          trigger on hover: the panel follows the open trigger. */}
      <Menubar className="flex items-stretch">
        {/* Whole-board save/open lives outside the Photo menu: it is available
            in both views and covers the grid + library, not just photos. */}
        <CatMenu label={t('Workspace')} hop={hop} onTriggerEnter={onTriggerEnter}>
          <Menu.Item className={itemCls} onClick={() => void doSaveFile()} disabled={saving || !anyFilled}>
            <MorphIcon icon={saving ? LoaderCircle : Save} size={13} strokeWidth={1.75} className={`flex text-dim ${saving ? ' animate-spin [animation-duration:900ms]' : ''}`} />
            {t('Save workspace file…')}
          </Menu.Item>
          <Menu.Item className={itemCls} onClick={() => wsFileRef.current?.click()}>
            <MorphIcon icon={FolderOpen} size={13} strokeWidth={1.75} className="flex text-dim" />
            {t('Open workspace file…')}
          </Menu.Item>
        </CatMenu>

        {grid
          ? (
            // Grid view is pure navigation: Help only (crop report is an
            // editing aid, library tools are hidden).
              <CatMenu label={t('Help')} hop={hop} onTriggerEnter={onTriggerEnter}>
                <Menu.Item className={itemCls} onClick={onToggleHelp}>
                  <MorphIcon icon={CircleHelp} size={13} strokeWidth={1.75} className="flex text-dim" />
                  {t('Keyboard shortcuts')}
                  <span className={hintCls}>?</span>
                </Menu.Item>
              </CatMenu>
            )
          : (
              <CatMenu label={t('Photo')} hop={hop} onTriggerEnter={onTriggerEnter}>
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
          <CatMenu label={t('Help')} hop={hop} onTriggerEnter={onTriggerEnter}>
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
      </Menubar>

      <span className="flex-1" />

      <TopBarActions
        grid={grid}
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
      <input
        ref={wsFileRef}
        type="file"
        accept=".json,.koma.json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f)
            return
          try {
            const parsed = await parseWorkspaceFile(f)
            setOpenDoc({ doc: parsed.doc, photos: parsed.photos })
          }
          catch (err) {
            const msg = (err as Error).message
            say(t('Failed to open workspace: {msg}', { msg: t(msg) }))
          }
        }}
      />

      <ConfirmDialog
        open={openDoc != null}
        title={t('Open workspace?')}
        description={t('Opening a workspace file replaces your current board and library. This cannot be undone.')}
        confirmLabel={t('Open')}
        danger
        onClose={() => setOpenDoc(null)}
        onConfirm={applyOpened}
      />
    </header>
  )
}
