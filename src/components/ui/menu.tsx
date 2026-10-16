import type { IconInput } from 'morphicons/react'
import type { MouseEventHandler, ReactNode } from 'react'
import { ContextMenu } from '@base-ui/react/context-menu'
import { ChevronRight } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useRef } from 'react'
import { liquidGlassRef } from '../../lib/liquidGlass'

/**
 * Shared chrome for every menu surface (the pane and canvas context menus, and
 * anything else that grows one later). One place so the right-click menus read
 * as the top bar's popups do.
 */

const itemBase = 'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-1.5 text-xs outline-0 data-disabled:cursor-default data-disabled:opacity-35'

export const menuItemCls = `${itemBase} text-txt data-highlighted:bg-chip-hover active:bg-chip-on active:text-chip-on-txt`

/** Destructive rows stay red, and invert while highlighted. */
export const menuDangerItemCls = `${itemBase} text-danger data-highlighted:bg-danger data-highlighted:text-on-accent active:bg-danger active:text-on-accent`

export const menuSeparatorCls = 'mx-1 my-1 h-px border-0 bg-line'

export const menuGroupLabelCls = 'px-2.5 pt-1 pb-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-faint'

/** The menu's own header row: not a section label, so no uppercase tracking. */
const menuTitleCls = 'block max-w-[240px] truncate px-2.5 pt-1 pb-0.5 text-[11px] text-faint'

export const menuPopupCls = 'min-w-[190px] rounded-none glass-liquid glass-pop p-1 outline-0 origin-[var(--transform-origin)] duration-(--dur-surface) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]'

/** Menu chrome without the motion, for surfaces that bring their own. */
export const menuSurfaceCls = 'min-w-[190px] rounded-none glass-liquid glass-pop p-1 outline-0'

/**
 * Enter/exit for popovers opened from the mobile tools dock (pane and label
 * docks alike): a 150ms fade with a slight scale and a nudge toward the
 * anchor, both ways, driven by Base UI's data-starting-style /
 * data-ending-style. The popups sit above the dock (side="top"), so they rise
 * out of the trigger. Under prefers-reduced-motion only the fade remains.
 */
export const dockPopupMotionCls = 'origin-[var(--transform-origin)] transition-[opacity,scale,translate,--glass-fade] duration-150 ease-(--ease-out) data-starting-style:opacity-0 data-starting-style:scale-[0.96] data-starting-style:translate-y-1 data-ending-style:opacity-0 data-ending-style:scale-[0.96] data-ending-style:translate-y-1 motion-reduce:data-starting-style:scale-100 motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-ending-style:scale-100 motion-reduce:data-ending-style:translate-y-0'

/**
 * Dock icon buttons: pressed (chip fill plus an accent bar along the bottom) while their popover is open, and an
 * inset accent ring on keyboard focus (inset so the dock's scroll box never
 * clips it).
 */
export const dockBtnStateCls = 'outline-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent data-popup-open:bg-chip-on data-popup-open:text-chip-on-txt data-popup-open:shadow-[inset_0_-2px_0_var(--accent)] data-popup-open:hover:bg-chip-on data-popup-open:hover:text-chip-on-txt'

export const menuHintCls = 'ml-auto flex items-center gap-1.5 pl-4 text-[10px] tabular-nums text-faint'

/** Right-aligned shortcut or count at the end of a menu row. */
export function MenuHint({ children }: { children: ReactNode }) {
  return <span className={menuHintCls}>{children}</span>
}

/**
 * Make Escape close an open menu. Base UI only handles Escape while the popup
 * (or its trigger) holds focus, and a pointer-opened context menu leaves focus
 * on the body, so without this the key would fall through to the app's global
 * shortcut and back out of the editor instead of just closing the menu.
 */
export function useMenuEscapeClose(open: boolean, close: () => void) {
  const closeRef = useRef(close)
  useEffect(
    () => { closeRef.current = close },
    [close],
  )
  useEffect(() => {
    if (!open)
      return
    // Capture, so the menu eats the key before the window-level handler sees it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape')
        return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open])
}

/** One clickable row: icon, translation, optional right-aligned hint. */
export function MenuItem({
  icon,
  hint,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  icon?: IconInput
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLElement>
  children: ReactNode
}) {
  return (
    <ContextMenu.Item
      className={danger ? menuDangerItemCls : menuItemCls}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <MorphIcon icon={icon} size={13} strokeWidth={1.75} className={danger ? undefined : 'text-dim'} />}
      {children}
      {hint != null && <MenuHint>{hint}</MenuHint>}
    </ContextMenu.Item>
  )
}

/**
 * A labelled run of rows, or a bare one when `label` is omitted. The `title`
 * variant is the menu's own header (the photo it acts on): sentence case and
 * truncating, unlike the small-caps section labels.
 */
export function MenuGroup({ label, variant = 'section', children }: { label?: ReactNode, variant?: 'section' | 'title', children: ReactNode }) {
  return (
    <ContextMenu.Group>
      {label != null && (
        <ContextMenu.GroupLabel className={variant === 'title' ? menuTitleCls : menuGroupLabelCls}>
          {label}
        </ContextMenu.GroupLabel>
      )}
      {children}
    </ContextMenu.Group>
  )
}

export function MenuSeparator() {
  return <ContextMenu.Separator className={menuSeparatorCls} />
}

/**
 * A row that opens a nested menu. The nested popup lives in its own portal, so
 * it can flip to the other side when it runs out of viewport.
 */
export function MenuSubmenu({
  icon,
  label,
  children,
}: {
  icon?: IconInput
  label: ReactNode
  children: ReactNode
}) {
  return (
    <ContextMenu.SubmenuRoot>
      <ContextMenu.SubmenuTrigger className={`${menuItemCls} data-popup-open:bg-chip-hover`}>
        {icon && <MorphIcon icon={icon} size={13} strokeWidth={1.75} className="text-dim" />}
        {label}
        <MorphIcon icon={ChevronRight} size={12} strokeWidth={1.75} className="ml-auto pl-3 text-faint" />
      </ContextMenu.SubmenuTrigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-90" sideOffset={-2} alignOffset={-6}>
          <ContextMenu.Popup ref={liquidGlassRef} className={menuPopupCls}>{children}</ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.SubmenuRoot>
  )
}
