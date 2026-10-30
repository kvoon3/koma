import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import type { DockBox } from '../lib/dockHighlight'
import type { Lang } from '../lib/i18n'
import type { WorkspaceDocV1 } from '../lib/workspaceFile'
import { Menu } from '@base-ui/react/menu'
import { Menubar } from '@base-ui/react/menubar'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Check, ChevronDown, CircleHelp, Download, FileText, FolderOpen, FolderPlus, Image as ImageIcon, ImagePlus, Languages, LayoutDashboard, LayoutGrid, Library, Moon, Save, Sun } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useMediaQuery } from '../hooks'
import { normalizeCutoutSets, pruneCutoutSets } from '../lib/cutoutVariants'
import { boxIn } from '../lib/dockBox'
import { glideDelta, isStill } from '../lib/dockHighlight'
import { clearFilterCaches } from '../lib/filterCache'
import { isTKey, setLang, useLang, useT } from '../lib/i18n'
import { clearImageCaches } from '../lib/imageStore'
import { EASE_OUT_CSS } from '../lib/motionTokens'
import { leafList } from '../lib/panes'
import { isGridPath, LIBRARY_PATH, OVERVIEW_PATH } from '../lib/routes'
import { clearSession } from '../lib/sessionStore'
import { paneAssetsOf } from '../lib/stickerLibrary'
import { say } from '../lib/toast'
import { buildDoc, downloadDoc, parseWorkspaceFile } from '../lib/workspaceFile'
import { activeWs, migrateWorkspaceInserts, normalizeWorkspaces, useStore } from '../store'
import { isDarkSnapshot, subscribeTheme, toggleDark } from '../theme'
import { BrandMark } from './BrandMark'
import { ConfirmDialog } from './ConfirmDialog'
import { SettingsPanel } from './SettingsPanel'
import { Button } from './ui/button'
import { buttonBase, buttonVariants } from './ui/buttonStyles'
import { Spinner } from './ui/spinner'
import { Tip } from './ui/tip'

const triggerCls = 'inline-flex cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent px-2.5 text-[11.5px] text-dim transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] pointer-coarse:px-3 pointer-coarse:text-xs max-sm:gap-0 max-sm:px-2.5 hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent aria-expanded:bg-chip-hover aria-expanded:text-txt'

/** The pitch a pointer-to-pointer glide covers; the dock row's GLIDE_S. */
const BAR_GLIDE_S = 0.12

function rectOf(el: Element): DockBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** The chip a pointer event started on, if it is one of the bar's own. */
function chipOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-bar-chip]') : null
}

/**
 * The bar's shared hover fill, the dock row's idiom (components/DockMarks): one
 * `bg-chip-hover` box glides under the chip the pointer marks, so the bar lights
 * as one surface instead of every chip tinting itself. The box is placed in the
 * header's content box, glides from its own painted rect, and snaps its size, so
 * a label change cannot smear it. The open menu's trigger keeps its own fill on
 * top, exactly as the dock's open tool does.
 *
 * Listeners are pointer handlers on the bar (components/TopBar); while a menu's
 * modal backdrop covers the bar, the window pointer hit-test below drives the
 * same placement, because that backdrop swallows `pointerover`.
 */
function useBarHighlight() {
  const barRef = useRef<HTMLElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const markRef = useRef<HTMLElement | null>(null)
  const shownRef = useRef(false)
  const animRef = useRef<Animation | null>(null)
  const observeRef = useRef<ResizeObserver | null>(null)
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')

  const clear = useCallback(() => {
    markRef.current = null
    shownRef.current = false
    animRef.current?.cancel()
    animRef.current = null
    observeRef.current?.disconnect()
    const box = boxRef.current
    if (!box)
      return
    box.style.transform = ''
    box.style.opacity = '0'
  }, [])

  const place = useCallback((el: HTMLElement, mode: 'instant' | 'glide' = 'glide') => {
    const box = boxRef.current
    const bar = barRef.current
    if (!box || !bar)
      return
    if (!el.isConnected || el.getClientRects().length === 0 || (el as HTMLButtonElement).disabled) {
      clear()
      return
    }
    const { x, y } = boxIn(bar, el)
    const width = el.offsetWidth
    const height = el.offsetHeight
    if (width < 1 || height < 1) {
      clear()
      return
    }
    const origin = bar.getBoundingClientRect()
    const target: DockBox = { left: origin.left + x, top: origin.top + y, width, height }
    const painted = rectOf(box)
    const wasShown = shownRef.current
    animRef.current?.cancel()
    animRef.current = null
    markRef.current = el
    // A label or display change resizes the chip under a still pointer; watch
    // the marked chip itself so the box follows without waiting for a move.
    observeRef.current?.disconnect()
    observeRef.current?.observe(el)
    box.style.left = `${x}px`
    box.style.top = `${y}px`
    box.style.width = `${width}px`
    box.style.height = `${height}px`
    box.style.opacity = '1'
    shownRef.current = true
    if (!wasShown || mode === 'instant' || reduce) {
      box.style.transform = ''
      return
    }
    if (isStill(painted, target)) {
      box.style.transform = ''
      return
    }
    const delta = glideDelta(painted, target)
    animRef.current = box.animate(
      [{ transform: `translate(${delta.x}px, ${delta.y}px)` }, { transform: 'translate(0px, 0px)' }],
      { duration: BAR_GLIDE_S * 1000, easing: EASE_OUT_CSS, fill: 'none' },
    )
  }, [clear, reduce])

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const el = markRef.current
      const box = boxRef.current
      // Observation reports the current size once on every mark; only a real
      // change may re-place, or that first report would cancel the glide.
      if (!el || !box || (el.offsetWidth === box.offsetWidth && el.offsetHeight === box.offsetHeight))
        return
      place(el, 'instant')
    })
    observeRef.current = observer
    return () => {
      observer.disconnect()
      observeRef.current = null
      animRef.current?.cancel()
    }
  }, [place])

  // A viewport change moves the chips without resizing the marked one (a
  // breakpoint hides a label elsewhere); re-place under the new layout.
  useEffect(() => {
    const onResize = () => {
      const el = markRef.current
      if (el)
        place(el, 'instant')
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [place])

  return { barRef, boxRef, place, clear }
}

const itemCls = 'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-1.5 text-xs text-txt outline-0 data-highlighted:bg-chip-hover active:bg-chip-on active:text-chip-on-txt data-disabled:cursor-default data-disabled:opacity-35'

// Right-aligned shortcut hint (and library count) inside a menu item.
const hintCls = 'ml-auto flex items-center gap-1.5 pl-4 text-[10px] tabular-nums text-faint'

// `data-instant` fires on menubar hand-offs: the incoming panel slides over from
// the trigger it left (no fade re-run), the outgoing one is gone at once.
const popupCls = 'min-w-[190px] rounded-none border border-line-strong bg-panel p-1 text-txt shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-(--dur-surface) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97] data-instant:transition-none data-instant:not-data-ending-style:animate-[menu-hop_var(--dur-surface)_var(--ease-out)]'

/** The top bar's dropdowns: they trade the open panel with each other on hover. */
type HeaderMenuId = 'workspace' | 'photo' | 'help' | 'lang'

/** What one dropdown trigger needs from the hand-over: its state and hover hook. */
interface MenuWiring {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTriggerEnter: (e: MouseEvent<HTMLButtonElement>) => void
}

function CatMenu({ label, icon, hop, open, onOpenChange, onTriggerEnter, children }: { label: string, icon: typeof CircleHelp, hop: number } & MenuWiring & { children: ReactNode }) {
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Tip
        label={label}
        trigger={(
          <Menu.Trigger className={triggerCls} aria-label={label} data-bar-chip="" onMouseEnter={onTriggerEnter}>
            <MorphIcon icon={icon} size={15} strokeWidth={1.75} className="hidden max-sm:inline-flex" />
            <span className="max-sm:hidden">{label}</span>
            <MorphIcon icon={ChevronDown} size={12} strokeWidth={1.75} className="max-sm:hidden" />
          </Menu.Trigger>
        )}
      />
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
  ['ja', '日本語'],
]

/**
 * The interface language, a two-row popup under the top bar next to the theme
 * toggle. It used to live in the settings drawer; a preference picked once in
 * a while belongs with the chrome, not behind a tab.
 */
function LangMenu({ open, onOpenChange, onTriggerEnter }: MenuWiring) {
  const t = useT()
  const lang = useLang()
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Tip
        label={t('Language')}
        trigger={(
          <Menu.Trigger
            className={`${buttonBase} ${buttonVariants.bar} aria-expanded:bg-chip-hover aria-expanded:text-txt`}
            aria-label={t('Language')}
            data-bar-trigger="lang"
            data-bar-chip=""
            onMouseEnter={onTriggerEnter}
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
  onSettingsOpenChange,
  onSettingsTriggerEnter,
  menuAt,
  busy,
  onExport,
  anyFilled,
  filled,
  dark,
}: {
  grid: boolean
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  onSettingsTriggerEnter: () => void
  menuAt: (id: HeaderMenuId) => MenuWiring
  busy: boolean
  onExport: () => void
  anyFilled: boolean
  filled: boolean
  dark: boolean
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-[5px] max-sm:gap-0.5">
      {/* The dropdown hangs off this button, so the panel and its trigger are one component. */}
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        onTriggerEnter={onSettingsTriggerEnter}
      />
      <Tip
        label={grid ? t('Export every non-empty workspace · ⌘E') : t('Export image · ⌘E')}
        trigger={(
          <Button
            variant="bar"
            onClick={onExport}
            icon={Download}
            iconSize={15}
            loading={busy}
            disabled={busy || (grid ? !anyFilled : !filled)}
            aria-label={t('Export image')}
            data-bar-chip=""
          >
            <span className="pointer-coarse:hidden max-sm:hidden">{busy ? t('Rendering') : t('Export')}</span>
          </Button>
        )}
      />
      <LangMenu {...menuAt('lang')} />
      <Tip
        label={dark ? t('Switch to light theme') : t('Switch to dark theme')}
        trigger={(
          <Button
            variant="bar"
            onClick={toggleDark}
            aria-label={dark ? t('Switch to light theme') : t('Switch to dark theme')}
            data-bar-chip=""
          >
            <MorphIcon icon={dark ? Sun : Moon} size={15} strokeWidth={1.75} />
          </Button>
        )}
      />
    </div>
  )
}

/**
 * The brand lockup, left of the menus: the mark rides the wordmark's baseline,
 * and the wordmark stays the one piece of chrome that speaks in a face of its
 * own. The face is a 1.1 KB subset that ships with the bundle (see
 * assets/fonts/SOURCE.md), so it is painted in the first frame, offline, with
 * no CDN face to swap in later. The 1px lift puts it on the menus' baseline: a
 * centered line box drops the mincho's baseline 1px below the 11.5px system
 * text's, and the two read as one line only when those baselines agree. The
 * mark is the 16px small cut, as tall as the type; the tight 224 crop keeps
 * it from carrying transparent padding into the gap, and the wider small-cut
 * gutters keep the three panes apart at 1×. Below `sm` the wordmark stands
 * aside and the mark alone carries the brand, so the phone bar is not left
 * with no lockup at all.
 */
function Wordmark() {
  return (
    <span
      aria-hidden
      className="relative top-[-1px] mr-2 flex flex-none items-center font-brand text-base leading-none font-bold text-txt"
    >
      <span className="flex items-baseline gap-2">
        <BrandMark className="h-4 w-4 flex-none" />
        <span className="max-sm:hidden">koma</span>
      </span>
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
/**
 * The left-hand category menus: whole-board save/open, the photo actions (or
 * the grid's library-only links) and Help. They read the bar's hand-over
 * wiring, so opening one follows the pointer to its neighbour.
 */
function TopBarMenus({
  grid,
  saving,
  anyFilled,
  photos,
  hop,
  menuAt,
  onSaveFile,
  onOpenWorkspaceFile,
  onAddPhotos,
  onAddFolder,
  onToggleLib,
  onGoLibrary,
  onClearAsk,
  onToggleHelp,
  onCrops,
}: {
  grid: boolean
  saving: boolean
  anyFilled: boolean
  photos: number
  hop: number
  menuAt: (id: HeaderMenuId) => MenuWiring
  onSaveFile: () => void
  onOpenWorkspaceFile: () => void
  onAddPhotos: () => void
  onAddFolder: () => void
  onToggleLib: () => void
  onGoLibrary: () => void
  onClearAsk: () => void
  onToggleHelp: () => void
  onCrops: () => void
}) {
  const t = useT()
  return (
    <Menubar className="flex items-stretch max-sm:gap-0">
      {/* Whole-board save/open lives outside the Photo menu: it is available
          in both views and covers the grid + library, not just photos. */}
      <CatMenu label={t('Workspace')} icon={LayoutDashboard} hop={hop} {...menuAt('workspace')}>
        <Menu.Item className={itemCls} onClick={onSaveFile} disabled={saving || !anyFilled}>
          {saving ? <Spinner size={13} className="flex text-dim" /> : <MorphIcon icon={Save} size={13} strokeWidth={1.75} className="flex text-dim" />}
          {t('Save workspace file…')}
        </Menu.Item>
        <Menu.Item className={itemCls} onClick={onOpenWorkspaceFile}>
          <MorphIcon icon={FolderOpen} size={13} strokeWidth={1.75} className="flex text-dim" />
          {t('Open workspace file…')}
        </Menu.Item>
      </CatMenu>

      {grid
        ? (
          // Grid view is pure navigation: the library is the one asset surface
          // it reaches (crop report is an editing aid and the photo tools stay
          // hidden), plus Help.
            <>
              <CatMenu label={t('Photo')} icon={ImageIcon} hop={hop} {...menuAt('photo')}>
                <Menu.Item className={itemCls} onClick={onGoLibrary}>
                  <MorphIcon icon={Library} size={13} strokeWidth={1.75} className="flex text-dim" />
                  {t('Library')}
                </Menu.Item>
              </CatMenu>
              <CatMenu label={t('Help')} icon={CircleHelp} hop={hop} {...menuAt('help')}>
                <Menu.Item className={itemCls} onClick={onToggleHelp}>
                  <MorphIcon icon={CircleHelp} size={13} strokeWidth={1.75} className="flex text-dim" />
                  {t('Keyboard shortcuts')}
                  <span className={hintCls}>?</span>
                </Menu.Item>
              </CatMenu>
            </>
          )
        : (
            <CatMenu label={t('Photo')} icon={ImageIcon} hop={hop} {...menuAt('photo')}>
              <Menu.Item className={itemCls} onClick={onAddPhotos}>
                <MorphIcon icon={ImagePlus} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Add photos…')}
              </Menu.Item>
              <Menu.Item className={itemCls} onClick={onAddFolder}>
                <MorphIcon icon={FolderPlus} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Add folder…')}
              </Menu.Item>
              <Menu.Item className={itemCls} onClick={onToggleLib}>
                <MorphIcon icon={LayoutGrid} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Library drawer')}
                <span className={hintCls}>
                  {photos ? `${photos} · ` : ''}
                  I
                </span>
              </Menu.Item>
              {/* The library is a hub destination, one page away. */}
              <Menu.Item className={itemCls} onClick={onGoLibrary}>
                <MorphIcon icon={Library} size={13} strokeWidth={1.75} className="flex text-dim" />
                {t('Library')}
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
        <CatMenu label={t('Help')} icon={CircleHelp} hop={hop} {...menuAt('help')}>
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
  )
}

export function TopBar({
  busy,
  settingsOpen,
  onToggleLib,
  onSettingsOpenChange,
  onToggleHelp,
  onExport,
  onCrops,
  onClearAsk,
}: {
  busy: boolean
  settingsOpen: boolean
  onToggleLib: () => void
  onSettingsOpenChange: (open: boolean) => void
  onToggleHelp: () => void
  onExport: () => void
  onCrops: () => void
  onClearAsk: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  const wsFileRef = useRef<HTMLInputElement>(null)

  const navigate = useNavigate()
  const grid = useRouterState({ select: s => isGridPath(s.location.pathname) })

  const [saving, setSaving] = useState(false)
  /** Parsed doc awaiting the replace-current-board confirm. */
  const [openDoc, setOpenDoc] = useState<{ doc: WorkspaceDocV1, photos: ReturnType<typeof useStore.getState>['photos'] } | null>(null)

  const prevTriggerXRef = useRef<number | null>(null)
  const [hop, setHop] = useState(0)
  /** The header dropdown holding the open panel; the settings panel keeps its own state. */
  const [openMenu, setOpenMenu] = useState<HeaderMenuId | null>(null)
  const bar = useBarHighlight()

  // The panel can be opened without a pointer on the bar (the `,` shortcut,
  // the canvas menu), so a menu left open gives way to it here, at render
  // time: it never paints over the panel for a frame.
  if (settingsOpen && openMenu != null)
    setOpenMenu(null)

  /**
   * The pointer moved from one header dropdown to the next, so the open panel
   * follows it, the move the menubar already makes between its own menus. With
   * nothing open this is a plain hover and opens nothing. The settings panel
   * runs with the menus: reached from one, left for one.
   */
  const handOver = useCallback((target: HeaderMenuId | 'settings') => {
    if (settingsOpen) {
      if (target === 'settings')
        return
      onSettingsOpenChange(false)
      setOpenMenu(target)
      return
    }
    if (openMenu == null || target === openMenu)
      return
    if (target === 'settings') {
      setOpenMenu(null)
      onSettingsOpenChange(true)
    }
    else {
      setOpenMenu(target)
    }
  }, [settingsOpen, openMenu, onSettingsOpenChange])

  // Menus hand over on hover: remember how far the incoming panel has to travel
  // (the gap between the trigger it left and the one it lands on) and give the
  // trigger the panel when one is already open.
  const triggerEnter = (id: HeaderMenuId) => (e: MouseEvent<HTMLButtonElement>) => {
    const x = e.currentTarget.getBoundingClientRect().left
    setHop((prevTriggerXRef.current ?? x) - x)
    prevTriggerXRef.current = x
    handOver(id)
  }

  /** One trigger's props: its own open state plus the hover hand-over above. */
  const menuAt = (id: HeaderMenuId): MenuWiring => ({
    open: openMenu === id,
    // A sibling's close must not clear the menu that just took over from it.
    onOpenChange: open => setOpenMenu(cur => (open ? id : cur === id ? null : cur)),
    onTriggerEnter: triggerEnter(id),
  })

  /**
   * An open category menu lays a modal backdrop over the rest of the bar (the
   * menubar's own element is its only cutout), so the pointer reaching the
   * settings and language triggers never fires their mouseenter and the panel
   * could not be picked up from a menu. While any dropdown is open, watch the
   * window's pointer instead and hit-test the chips marked `data-bar-chip`
   * through that backdrop, so the hand-over and the shared fill both run in
   * both directions.
   */
  // The handler only has to *use* the latest hand-over; re-subscribing the
  // window listener whenever `handOver` changes identity (it closes over the
  // open menu) buys nothing.
  const onBarPointerMove = useEffectEvent((e: globalThis.MouseEvent) => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-bar-chip]')) {
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        if (el.dataset.barTrigger)
          handOver(el.dataset.barTrigger as HeaderMenuId | 'settings')
        bar.place(el)
        return
      }
    }
    bar.clear()
  })

  useEffect(() => {
    if (openMenu == null && !settingsOpen)
      return
    window.addEventListener('mousemove', onBarPointerMove)
    return () => window.removeEventListener('mousemove', onBarPointerMove)
  }, [openMenu, settingsOpen])

  // The hint counts what the drawer shows: photos and music cards, never stickers.
  const photos = useStore(s => paneAssetsOf(s.photos).length)
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
    // Filtered bitmaps are keyed by photo id too: a replaced library must not
    // serve the old board's textures.
    clearFilterCaches()
    void clearSession()
    const workspaces = normalizeWorkspaces(doc.workspaces).map(w => migrateWorkspaceInserts(w, photos))
    useStore.setState({
      photos,
      workspaces,
      activeId: workspaces.some(w => w.id === doc.activeId) ? doc.activeId : workspaces[0].id,
      gap: doc.settings.gap,
      radius: doc.settings.radius,
      bg: doc.settings.bg,
      cutouts: doc.cutouts ?? {},
      // A file from a build before the Cut out menu has no variant table, and
      // one from anywhere else is untrusted: keep only well-formed rows whose
      // photos actually came along.
      cutoutSets: pruneCutoutSets(normalizeCutoutSets(doc.cutoutSets), new Set(photos.map(p => p.id))),
      // Sticker folders ride with the file; a file saved before them has none.
      stickerFolders: doc.stickerFolders ?? [],
      bgGradient: doc.settings.bgGradient ?? null,
      // A saved photo id only applies if that photo came along in the file.
      bgImage: doc.settings.bgImage && photos.some(p => p.id === doc.settings.bgImage!.photoId) ? doc.settings.bgImage : null,
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
    // A board opened from a file has nothing behind it to undo back into.
    useStore.getState().resetHistory()
    setOpenDoc(null)
    say(t('Workspace opened'))
    void navigate({ to: OVERVIEW_PATH })
  }

  return (
    <header
      ref={bar.barRef}
      onPointerOver={(e) => {
        // Touch fires a synthetic hover before its tap; the tap itself paints.
        if (e.pointerType !== 'mouse')
          return
        const el = chipOf(e.target)
        if (el)
          bar.place(el)
        else
          bar.clear()
      }}
      onPointerDown={(e) => {
        const el = chipOf(e.target)
        if (el)
          bar.place(el, 'instant')
      }}
      onPointerUp={(e) => {
        // A tap's fill has no hover to fall back on; a mouse keeps its mark.
        if (e.pointerType !== 'mouse')
          bar.clear()
      }}
      onPointerLeave={bar.clear}
      className="app-titlebar relative isolate z-40 flex h-[var(--statusH)] flex-none items-stretch border-b border-line bg-statusbar"
    >
      {/*
        The hover fill: one chip-hover box under every bar chip, a sibling of
        their layout so it never shifts the row. A negative z-index inside the
        header's stacking context paints it above the bar surface and below the
        labels.
      */}
      <div
        ref={bar.boxRef}
        aria-hidden="true"
        data-bar-highlight=""
        className="pointer-events-none absolute top-0 left-0 z-[-1] rounded-none bg-chip-hover opacity-0 transition-opacity duration-(--dur-fast) ease-(--ease-out)"
      />
      <Wordmark />
      {/* The menubar is what makes a click-opened menu hand over to the next
          trigger on hover: the panel follows the open trigger. */}
      <TopBarMenus
        grid={grid}
        saving={saving}
        anyFilled={anyFilled}
        photos={photos}
        hop={hop}
        menuAt={menuAt}
        onSaveFile={() => void doSaveFile()}
        onOpenWorkspaceFile={() => wsFileRef.current?.click()}
        onAddPhotos={() => fileRef.current?.click()}
        onAddFolder={() => dirRef.current?.click()}
        onToggleLib={onToggleLib}
        onGoLibrary={() => void navigate({ to: LIBRARY_PATH })}
        onClearAsk={onClearAsk}
        onToggleHelp={onToggleHelp}
        onCrops={onCrops}
      />

      <span className="flex-1" />

      <TopBarActions
        grid={grid}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
        onSettingsTriggerEnter={() => handOver('settings')}
        menuAt={menuAt}
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
            say(t('Failed to open workspace: {msg}', { msg: isTKey(msg) ? t(msg) : msg }))
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
