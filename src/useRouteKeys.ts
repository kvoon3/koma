import type { Dispatch, SetStateAction } from 'react'
import type { Action } from './lib/actionGuard'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { bindAction, paneContext } from './lib/actionGuard'
import { leafList } from './lib/panes'
import { GRID_PATH } from './lib/routes'
import { viewTransitionOption } from './lib/viewTransition'
import { activeWs, useStore } from './store'

/**
 * The app-wide keyboard map for both routes. A surface that already claimed
 * the key owns it, and while the export dialog is up the board behind it must
 * not react to the keyboard at all.
 */

type StoreState = ReturnType<typeof useStore.getState>
type ActiveWorkspace = ReturnType<typeof activeWs>

interface KeyUi {
  helpOpen: boolean
  libOpen: boolean
  settingsOpen: boolean
  report: string | null
  doCrops: () => void
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setLibOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setReport: Dispatch<SetStateAction<string | null>>
  /** Back out of the editor to the grid overview (`#/grid`). */
  goGrid: () => void
}

/** The chrome state and setters the key map acts on. */
export type RouteKeyChrome = Omit<KeyUi, 'goGrid'>

function isTypingTarget(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  return t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

/**
 * Undo / redo of the board: ⌘Z, ⇧⌘Z (and Ctrl+Y). A text field keeps its own
 * native undo, so typing inside a label stays the field's. Returns true when
 * the key was a history step.
 */
function handleHistoryKey(e: KeyboardEvent, s: StoreState): boolean {
  const k = e.key.toLowerCase()
  if ((k !== 'z' && k !== 'y') || isTypingTarget(e))
    return false
  e.preventDefault()
  if (k === 'z' && !e.shiftKey)
    s.undo()
  else
    s.redo()
  return true
}

// v/s/x/d/r act on the focused pane. Same precondition gate as the dock
// (`bindAction`): no live focused pane (or no photo, for d) → no-op.
function paneKeyActions(s: StoreState): Record<'v' | 's' | 'x' | 'd' | 'r', Action> {
  return {
    v: { requires: 'pane', run: p => s.split(p.paneId, 'row') },
    s: { requires: 'pane', run: p => s.split(p.paneId, 'column') },
    x: { requires: 'pane', run: p => s.closePane(p.paneId) },
    d: { requires: 'photo', run: p => s.removePhoto(p.paneId) },
    r: { requires: 'pane', run: p => s.updateLeaf(p.paneId, { zoom: 1, cx: 0.5, cy: 0.5 }) },
  }
}

function focusedPaneContext(ws: ActiveWorkspace) {
  return paneContext(ws.focusId, (id) => {
    const leaf = leafList(ws.root).find(l => l.id === id)
    return leaf ? { photo: leaf.photoId ?? null } : null
  })
}

function paneDir(key: string): 'left' | 'right' | 'up' | 'down' {
  if (key === 'h')
    return 'left'
  if (key === 'l')
    return 'right'
  if (key === 'k')
    return 'up'
  return 'down'
}

function focusNextLeaf(s: StoreState, ws: ActiveWorkspace) {
  const leaves = leafList(ws.root)
  if (!leaves.length)
    return
  const i = leaves.findIndex(l => l.id === ws.focusId)
  s.focus(leaves[(i + 1 + leaves.length) % leaves.length].id)
}

function handleEscapeKey(s: StoreState, ui: KeyUi) {
  if (ui.helpOpen || ui.libOpen || ui.settingsOpen || ui.report != null) {
    ui.setHelpOpen(false)
    ui.setLibOpen(false)
    ui.setSettingsOpen(false)
    ui.setReport(null)
  }
  else if (s.labelSel || s.stickerSel) {
    s.selectLabel(null)
  }
  else {
    // Nothing left to dismiss: back out of the editor to the grid overview.
    ui.goGrid()
  }
}

function handleGridKey(e: KeyboardEvent, k: string, ui: KeyUi) {
  if (k === ',') {
    e.preventDefault()
    ui.setSettingsOpen(v => !v)
    ui.setLibOpen(false)
  }
  else if (k === '?') {
    e.preventDefault()
    ui.setHelpOpen(v => !v)
  }
}

// Letter keys match either case, as in v/V, s/S above.
function handleEditKey(e: KeyboardEvent, k: string, s: StoreState, ui: KeyUi) {
  const key = k.toLowerCase()
  const ws = activeWs(s)

  switch (key) {
    case 'v':
    case 's':
    case 'x':
    case 'd':
    case 'r':
      bindAction(paneKeyActions(s)[key], focusedPaneContext(ws))?.()
      break

    case 'h':
    case 'j':
    case 'k':
    case 'l':
      e.preventDefault()
      s.focusNeighbor(paneDir(key))
      break

    case 'i':
      e.preventDefault()
      ui.setLibOpen(v => !v)
      ui.setSettingsOpen(false)
      break

    case ',':
      e.preventDefault()
      ui.setSettingsOpen(v => !v)
      ui.setLibOpen(false)
      break

    case '?':
      e.preventDefault()
      ui.setHelpOpen(v => !v)
      break

    case 'tab':
      // A dialog owns Tab while it is open: the settings drawer's tab list and
      // its controls sit in the focus trap, so leave the browser's focus
      // movement alone instead of cycling panes behind the dialog.
      if (!(e.target as HTMLElement).closest('[role="dialog"]')) {
        e.preventDefault()
        focusNextLeaf(s, ws)
      }
      break

    case 'c':
      ui.doCrops()
      break

    case 'escape':
      handleEscapeKey(s, ui)
      break
  }
}

/**
 * Bind the key map to the window: mod+Z / mod+E, g for the route toggle, and
 * the grid / editor maps behind it. `exportOpen` is the export dialog's
 * presence; while it is up the board ignores the keyboard entirely.
 */
export function useRouteKeys({ grid, hub = false, exportOpen, onExport, chrome }: {
  /** The overview (`#/grid`) owns different bindings than the editor. */
  grid: boolean
  /**
   * A hub route (the launcher or one of its two libraries) shows no board, so
   * every board binding (pane keys, focus, undo, export, the G toggle) is inert
   * there: they would otherwise edit a board the user cannot see. Settings and
   * help still open.
   */
  hub?: boolean
  exportOpen: boolean
  /** Run the current route's export (mod+E). */
  onExport: () => void
  chrome: RouteKeyChrome
}) {
  const navigate = useNavigate()
  const { helpOpen, libOpen, settingsOpen, report, doCrops, setHelpOpen, setLibOpen, setSettingsOpen, setReport } = chrome

  // The ⌘E branch only has to *call* the latest export; re-subscribing the
  // window listener whenever `onExport` changes identity (which happens when
  // `grid` flips) buys nothing. `onExport` itself stays a plain callback:
  // TopBar and the AppCommands context hand it to children, where an effect
  // event would be wrong.
  const exportHotkey = useEffectEvent(() => {
    onExport()
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A surface that already claimed the key owns it (base-ui closes a dialog
      // on Escape and calls `preventDefault`), and while the export dialog is
      // up the board behind it must not react to the keyboard at all.
      if (e.defaultPrevented || exportOpen)
        return
      if (e.metaKey || e.ctrlKey) {
        if (handleHistoryKey(e, useStore.getState()))
          return
        if (e.key.toLowerCase() === 'e') {
          e.preventDefault()
          exportHotkey()
        }
        return
      }
      if (isTypingTarget(e))
        return

      const k = e.key
      const ui: KeyUi = {
        helpOpen,
        libOpen,
        settingsOpen,
        report,
        doCrops,
        setHelpOpen,
        setLibOpen,
        setSettingsOpen,
        setReport,
        goGrid: () => {
          useStore.getState().clearSelection()
          void navigate({ to: GRID_PATH, viewTransition: viewTransitionOption() })
        },
      }

      if (hub) {
        // A hub route shows no board, so only the popover keys it shares with
        // the overview act there: a pane key would edit a board out of sight.
        handleGridKey(e, k, ui)
        return
      }

      const s = useStore.getState()

      if (k === 'G' || k === 'g') {
        e.preventDefault()
        s.clearSelection()
        if (grid)
          void navigate({ to: '/w/$wsId', params: { wsId: s.activeId }, viewTransition: viewTransitionOption() })
        else
          void navigate({ to: GRID_PATH, viewTransition: viewTransitionOption() })
        return
      }

      // Grid view is pure navigation: arrows / hjkl / Tab / Enter are handled
      // by the WorkspaceGrid's own listener (mounted only in grid view);
      // everything else edit-specific is swallowed here.
      if (grid) {
        handleGridKey(e, k, ui)
        return
      }

      handleEditKey(e, k, s, ui)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [helpOpen, libOpen, settingsOpen, report, setHelpOpen, setLibOpen, setSettingsOpen, setReport, doCrops, grid, hub, navigate, exportOpen])
}
