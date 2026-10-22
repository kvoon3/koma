/* eslint-disable react-refresh/only-export-components -- a code-based route module necessarily mixes the exported router instance with its route components. */
import type { ExportItem } from './components/ExportDialog'
import type { AppCommands } from './lib/appCommands'
import type { RenderedItem } from './lib/exportRun'
import type { LibrarySearch } from './lib/library'
import { Tooltip } from '@base-ui/react/tooltip'
import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet, redirect, useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog'
import { CropDialog } from './components/CropDialog'
import { ExportDialog } from './components/ExportDialog'
import { FloatActions } from './components/FloatActions'
import { HelpOverlay } from './components/HelpOverlay'
import { LegacyIndex } from './components/LegacyIndex'
import { LibraryPage } from './components/library/LibraryPage'
import { LibraryDrawer } from './components/LibraryDrawer'
import { MusicCardDialog } from './components/MusicCardDialog'
import { Stage } from './components/Stage'
import ToastHost from './components/ToastHost'
import { ToolsDockHost } from './components/ToolsDock'
import { TopBar } from './components/TopBar'
import { WeChatGuard } from './components/WeChatGuard'
import { WorkspaceGrid } from './components/WorkspaceGrid'
import { AppCommandsContext } from './lib/appCommands'
import { buildCropReport } from './lib/exporter'
import { exportOptions, renderGridCellItems, renderGridItems, renderWorkspaceItems } from './lib/exportFlow'
import { armRun, releaseRun } from './lib/exportRun'
import { hubKeyForPath, markHubSeen } from './lib/hubSeen'
import { t } from './lib/i18n'
import { parseLibraryType } from './lib/library'
import { EDITOR_PATH, isGridPath, isHubPath, LEGACY_INDEX_PATH, LIBRARY_PATH, OVERVIEW_PATH, PHOTOS_PATH, STICKERS_PATH } from './lib/routes'
import { say } from './lib/toast'
import { viewTransitionOption } from './lib/viewTransition'
import { useStore } from './store'
import { initTheme } from './theme'
import { usePersisted } from './usePersisted'
import { useRouteKeys } from './useRouteKeys'

/** The app chrome: it wraps every route and renders the active view in `<Outlet />`. */
function RootLayout() {
  const navigate = useNavigate()
  const grid = useRouterState({ select: s => isGridPath(s.location.pathname) })
  // A library route (or the retained launcher) is not a board: it draws its own
  // chrome and none of the board's floating actions belong over it.
  const hub = useRouterState({ select: s => isHubPath(s.location.pathname) })
  const pathname = useRouterState({ select: s => s.location.pathname })

  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [clearAsk, setClearAsk] = useState(false)
  /** The finished export run the dialog is showing; null while none is open. */
  const [exportItems, setExportItems] = useState<ExportItem[] | null>(null)
  /** The run the preview URLs belong to, held past the dialog's close. */
  const runRef = useRef<ExportItem[] | null>(null)

  const [libOpen, setLibOpen] = usePersisted('libOpen', false)
  const [settingsOpen, setSettingsOpen] = usePersisted('settingsOpen', false)
  const [helpOpen, setHelpOpen] = useState(false)
  // One music card dialog for the whole app: the stage dock and the library
  // header only flip this flag.
  const musicCardOpen = useStore(s => s.musicCardOpen)
  const setMusicCardOpen = useStore(s => s.setMusicCardOpen)

  initTheme()

  // The retained launcher's cards say when each destination was last opened:
  // the chrome records every visit here, whichever route the user came from (a
  // board is a grid-making visit, the two libraries are their own).
  useEffect(() => {
    const key = hubKeyForPath(pathname)
    if (key)
      markHubSeen(key)
  }, [pathname])

  // Pinch/ctrl+wheel zooms the pane under the cursor (handled there); anywhere
  // else it would zoom the whole browser page, which we never want.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.defaultPrevented)
        e.preventDefault()
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  /** Hand a finished run to the dialog, letting the run it replaces go. */
  const showRun = useCallback((rendered: RenderedItem[]) => {
    const run = armRun(rendered, runRef.current)
    runRef.current = run
    setExportItems(run)
  }, [])

  /** The dialog has animated out: its run is off screen, its URLs can go. */
  const dropRun = useCallback(() => {
    releaseRun(runRef.current)
    runRef.current = null
    setExportItems(null)
  }, [])

  const doExport = useCallback(async () => {
    setBusy(true)
    say(t('Rendering at original resolution...'))
    try {
      const items = grid ? await renderGridItems() : await renderWorkspaceItems()
      if (items.length)
        showRun(items)
    }
    catch (e) {
      say(t('Export failed: {msg}', { msg: (e as Error).message }))
    }
    finally {
      setBusy(false)
    }
  }, [grid, showRun])

  const doExportGridCells = useCallback(async () => {
    setBusy(true)
    say(t('Rendering at original resolution...'))
    try {
      const items = await renderGridCellItems()
      if (items.length)
        showRun(items)
    }
    catch (e) {
      say(t('Export failed: {msg}', { msg: (e as Error).message }))
    }
    finally {
      setBusy(false)
    }
  }, [showRun])

  const doCrops = useCallback(() => setReport(buildCropReport(exportOptions())), [])

  // The chrome commands a menu deep in the tree may invoke (see CanvasMenu).
  const commands = useMemo<AppCommands>(() => ({
    exportNow: doExport,
    exportGridCells: doExportGridCells,
    showCrops: doCrops,
    setLibraryOpen: setLibOpen,
    setSettingsOpen,
    setHelpOpen,
    busy,
    grid,
  }), [doExport, doExportGridCells, doCrops, setLibOpen, setSettingsOpen, busy, grid])

  // The app-wide key map: mod+Z / mod+E, g for the route toggle, and the
  // grid / editor maps behind it (see useRouteKeys).
  useRouteKeys({
    grid,
    hub,
    exportOpen: exportItems != null,
    onExport: doExport,
    chrome: { helpOpen, libOpen, settingsOpen, report, doCrops, setHelpOpen, setLibOpen, setSettingsOpen, setReport },
  })

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length)
        return
      e.preventDefault()
      const s = useStore.getState()
      const created = s.addPhotos(files)
      say(created.length ? t('Added {n} photos', { n: created.length }) : t('No image files found'))
      if (!created.length)
        return
      // The overview has no pane to drop into: autoFill has already filled the
      // active workspace's empty panes, so open it where the photos landed.
      if (grid) {
        useStore.getState().clearSelection()
        void navigate({ to: '/w/$wsId', params: { wsId: s.activeId }, viewTransition: viewTransitionOption() })
      }
      // A library route lists the photos itself, so the drawer would only
      // cover what the drop just filled.
      if (!hub)
        setLibOpen(true)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [setLibOpen, grid, hub, navigate])

  const closeHelp = () => setHelpOpen(false)

  return (
    <Tooltip.Provider delay={300}>
      <div className="relative isolate flex h-full flex-col">
        <TopBar
          busy={busy}
          settingsOpen={settingsOpen}
          onToggleLib={() => {
            setLibOpen(v => !v)
            setSettingsOpen(false)
          }}
          onSettingsOpenChange={(open) => {
            setSettingsOpen(open)
            // The library drawer and the settings dropdown never share the
            // screen: opening either puts the other away.
            if (open)
              setLibOpen(false)
          }}
          onToggleHelp={() => setHelpOpen(v => !v)}
          onExport={doExport}
          onCrops={doCrops}
          onClearAsk={() => setClearAsk(true)}
        />

        {/* One persistent dock for every route; routes portal their tools in. */}
        <ToolsDockHost>
          <main className="relative min-h-0 flex-1">
            <AppCommandsContext value={commands}>
              <Outlet />
              {/* Floating page actions (back / reset) hover over the active view. */}
              {!hub && <FloatActions />}
            </AppCommandsContext>
          </main>
        </ToolsDockHost>

        {/* Footer rides inside ToolsDock (full-width sheet). */}
        <LibraryDrawer open={libOpen} onClose={() => setLibOpen(false)} onRequestClear={() => setClearAsk(true)} />

        <HelpOverlay open={helpOpen} onClose={closeHelp} />

        <WeChatGuard />

        <MusicCardDialog open={musicCardOpen} onClose={() => setMusicCardOpen(false)} />

        <ToastHost />

        <CropDialog report={report} onClose={() => setReport(null)} />

        <ExportDialog items={exportItems} onClose={() => setExportItems(null)} onReleased={dropRun} />

        <ConfirmDialog
          open={clearAsk}
          title={t('Clear library?')}
          description={t('This removes all imported photos and resets all workspaces to blank canvases. This cannot be undone.')}
          confirmLabel={t('Clear all')}
          danger
          onClose={() => setClearAsk(false)}
          onConfirm={() => {
            useStore.getState().clearLibrary()
            setClearAsk(false)
            say(t('Library cleared'))
          }}
        />
      </div>
    </Tooltip.Provider>
  )
}

/**
 * `/w/$wsId` → the editing stage. The route param drives the store's
 * `activeId` (the canvas itself stays store-driven); an unknown id bounces
 * back to the grid instead of rendering a workspace that does not exist.
 */
function WorkspaceRoute() {
  const { wsId } = useParams({ from: '/w/$wsId' })
  const navigate = useNavigate()
  const exists = useStore(s => s.workspaces.some(w => w.id === wsId))

  useEffect(() => {
    if (exists) {
      useStore.getState().patch({ activeId: wsId })
      useStore.getState().clearSelection()
    }
    else {
      void navigate({ to: OVERVIEW_PATH, replace: true })
    }
  }, [wsId, exists, navigate])

  return exists ? <Stage /> : null
}

const rootRoute = createRootRoute({ component: RootLayout })

/** `/`: the 3×3 board overview, where the app opens (the root it always had). */
const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: OVERVIEW_PATH,
  component: WorkspaceGrid,
})

/**
 * `#/legacy-index`: the launcher drafted while the hub root was under review,
 * kept routable and working but linked from nowhere (see `components/LegacyIndex`).
 */
const legacyIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LEGACY_INDEX_PATH,
  component: LegacyIndex,
})

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: EDITOR_PATH,
  component: WorkspaceRoute,
})

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LIBRARY_PATH,
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({ type: parseLibraryType(search.type) }),
  component: LibraryPage,
})

// The old per-type routes keep their links working: each opens the library on
// its own tab, with no intermediate page.
const photoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PHOTOS_PATH,
  beforeLoad: () => {
    throw redirect({ to: LIBRARY_PATH, search: { type: 'photo' } })
  },
})

const stickerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: STICKERS_PATH,
  beforeLoad: () => {
    throw redirect({ to: LIBRARY_PATH, search: { type: 'sticker' } })
  },
})

const routeTree = rootRoute.addChildren([overviewRoute, legacyIndexRoute, workspaceRoute, libraryRoute, photoRoute, stickerRoute])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
