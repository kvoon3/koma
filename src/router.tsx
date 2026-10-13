/* eslint-disable react-refresh/only-export-components -- a code-based route module necessarily mixes the exported router instance with its route components. */
import type { Dispatch, SetStateAction } from 'react'
import type { AppCommands } from './lib/appCommands'
import type { ExportOptions } from './lib/exporter'
import { Tooltip } from '@base-ui/react/tooltip'
import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog'
import { CropDialog } from './components/CropDialog'
import { FloatActions } from './components/FloatActions'
import { Footer } from './components/Footer'
import { HelpOverlay } from './components/HelpOverlay'
import { LibraryDrawer } from './components/LibraryDrawer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { Stage } from './components/Stage'
import ToastHost from './components/ToastHost'
import { TopBar } from './components/TopBar'
import { WorkspaceGrid } from './components/WorkspaceGrid'
import { AppCommandsContext } from './lib/appCommands'
import { buildCropReport, downloadBlob, hasLiveCells, renderCollage, renderCollageVideo, renderGridSnapshot } from './lib/exporter'
import { t } from './lib/i18n'
import { leafList } from './lib/panes'
import { say } from './lib/toast'
import { viewTransitionOption } from './lib/viewTransition'
import { activeWs, isTransparentBg, photoMap, useStore } from './store'
import { initTheme } from './theme'
import { usePersisted } from './usePersisted'

function exportOptions(): ExportOptions {
  const s = useStore.getState()
  const ws = activeWs(s)
  return {
    root: ws.root,
    ratio: ws.canvasRatio ?? 1.5,
    gap: s.gap,
    radius: s.radius,
    bg: s.bg,
    edgeFade: s.edgeFade,
    edgeFadeStrength: s.edgeFadeStrength,
    photos: photoMap(s.photos),
    longSide: s.longSide,
  }
}

/** A canvas as a downloadable file: PNG carries the transparent gap fill, else the export format. */
async function canvasBlob(canvas: HTMLCanvasElement): Promise<{ blob: Blob, ext: 'png' | 'jpg' }> {
  const s = useStore.getState()
  const format = isTransparentBg(s.bg) ? 'image/png' : s.format
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, format, s.quality))
  if (!blob)
    throw new Error('Failed to create image')
  return { blob, ext: format === 'image/png' ? 'png' : 'jpg' }
}

/** `MMDDHHmm`, the stamp every export file name carries. */
function exportStamp(): string {
  return new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
}

/** One export per non-empty workspace, in grid order, named by position. */
async function exportGrid() {
  const s = useStore.getState()
  const filled = s.workspaces.filter(w => leafList(w.root).some(l => l.photoId))
  for (let i = 0; i < filled.length; i++) {
    const ws = filled[i]
    say(t('Rendering {n} / {total}...', { n: i + 1, total: filled.length }))
    const opts: ExportOptions = {
      root: ws.root,
      ratio: ws.canvasRatio ?? 1.5,
      gap: s.gap,
      radius: s.radius,
      bg: s.bg,
      edgeFade: s.edgeFade,
      edgeFadeStrength: s.edgeFadeStrength,
      photos: photoMap(s.photos),
      longSide: s.longSide,
    }
    const canvas = await renderCollage(opts)
    const { blob, ext } = await canvasBlob(canvas)
    // Position among the filled workspaces at export time, 1-based.
    const pos = s.workspaces.indexOf(ws) + 1
    const base = `collage_${pos}_${canvas.width}x${canvas.height}_${exportStamp()}`
    downloadBlob(blob, `${base}.${ext}`)
    await exportLiveVideo(opts, canvas, base)
    canvas.width = canvas.height = 0
  }
  say(filled.length === 1 ? t('Exported {n} image', { n: 1 }) : t('Exported {n} images', { n: filled.length }))
}

/** The whole 3×3 board as one image, named like the other exports. */
async function exportGridSnapshot() {
  const s = useStore.getState()
  const canvas = await renderGridSnapshot({
    workspaces: s.workspaces,
    longSide: s.longSide,
    gridGap: s.gridGap,
    radius: s.radius,
    bg: s.bg,
    edgeFade: s.edgeFade,
    edgeFadeStrength: s.edgeFadeStrength,
    photos: photoMap(s.photos),
  })
  const { blob, ext } = await canvasBlob(canvas)
  const W = canvas.width
  const H = canvas.height
  downloadBlob(blob, `grid_${W}x${H}_${exportStamp()}.${ext}`)
  canvas.width = canvas.height = 0
  say(t('Exported {w} × {h} ({ext})', { w: W, h: H, ext: ext.toUpperCase() }))
}

/**
 * When any pane holds a Live Photo, export also records a video of the
 *  collage with those panes playing, named to pair with the still by
 *  basename (the same convention as Apple's IMG_1234.HEIC + IMG_1234.MOV).
 */
async function exportLiveVideo(opts: ExportOptions, still: HTMLCanvasElement, base: string) {
  if (!hasLiveCells(opts))
    return
  say(t('Recording live video...'))
  const r = await renderCollageVideo(opts, still)
  if (!r) {
    say(t('Live video export is not supported in this browser'))
    return
  }
  downloadBlob(r.blob, `${base}.${r.ext}`)
  say(t('Exported live video ({ext})', { ext: r.ext.toUpperCase() }))
}

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
  /** Back out of the editor to the grid overview (`/`). */
  goGrid: () => void
}

function isTypingTarget(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  return t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

// v/s/x/d/r act on the focused pane, when there is one.
const paneActions: Record<string, (s: StoreState, paneId: string) => void> = {
  v: (s, paneId) => s.split(paneId, 'row'),
  s: (s, paneId) => s.split(paneId, 'column'),
  x: (s, paneId) => s.closePane(paneId),
  d: (s, paneId) => s.removePhoto(paneId),
  r: (s, paneId) => s.updateLeaf(paneId, { zoom: 1, cx: 0.5, cy: 0.5 }),
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
      if (ws.focusId)
        paneActions[key](s, ws.focusId)
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

/** The app chrome: it wraps every route and renders the active view in `<Outlet />`. */
function RootLayout() {
  const navigate = useNavigate()
  const grid = useRouterState({ select: s => s.location.pathname === '/' })

  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [clearAsk, setClearAsk] = useState(false)

  const [libOpen, setLibOpen] = usePersisted('libOpen', false)
  const [settingsOpen, setSettingsOpen] = usePersisted('settingsOpen', false)
  const [helpOpen, setHelpOpen] = useState(false)

  initTheme()

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

  const doExport = useCallback(async () => {
    setBusy(true)
    say(t('Rendering at original resolution...'))
    try {
      if (grid) {
        await exportGrid()
      }
      else {
        const opts = exportOptions()
        const canvas = await renderCollage(opts)
        const { blob, ext } = await canvasBlob(canvas)
        const base = `collage_${canvas.width}x${canvas.height}_${exportStamp()}`
        downloadBlob(blob, `${base}.${ext}`)
        say(t('Exported {w} × {h} ({ext})', { w: canvas.width, h: canvas.height, ext: ext.toUpperCase() }))
        await exportLiveVideo(opts, canvas, base)
        canvas.width = canvas.height = 0
      }
    }
    catch (e) {
      say(t('Export failed: {msg}', { msg: (e as Error).message }))
    }
    finally {
      setBusy(false)
    }
  }, [grid])

  const doSnapshotGrid = useCallback(async () => {
    setBusy(true)
    say(t('Rendering the 3×3 snapshot...'))
    try {
      await exportGridSnapshot()
    }
    catch (e) {
      say(t('Export failed: {msg}', { msg: (e as Error).message }))
    }
    finally {
      setBusy(false)
    }
  }, [])

  const doCrops = useCallback(() => setReport(buildCropReport(exportOptions())), [])

  // The chrome commands a menu deep in the tree may invoke (see CanvasMenu).
  const commands = useMemo<AppCommands>(() => ({
    exportNow: doExport,
    snapshotGrid: doSnapshotGrid,
    showCrops: doCrops,
    setLibraryOpen: setLibOpen,
    setSettingsOpen,
    setHelpOpen,
    busy,
    grid,
  }), [doExport, doSnapshotGrid, doCrops, setLibOpen, setSettingsOpen, busy, grid])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'e') {
          e.preventDefault()
          doExport()
        }
        return
      }
      if (isTypingTarget(e))
        return

      const s = useStore.getState()
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
          void navigate({ to: '/', viewTransition: viewTransitionOption() })
        },
      }

      if (k === 'G' || k === 'g') {
        e.preventDefault()
        useStore.getState().clearSelection()
        if (grid)
          void navigate({ to: '/w/$wsId', params: { wsId: s.activeId }, viewTransition: viewTransitionOption() })
        else
          void navigate({ to: '/', viewTransition: viewTransitionOption() })
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
  }, [helpOpen, libOpen, settingsOpen, report, setLibOpen, setSettingsOpen, doExport, doCrops, grid, navigate])

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
      setLibOpen(true)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [setLibOpen, grid, navigate])

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
          onToggleSettings={() => {
            setSettingsOpen(v => !v)
            setLibOpen(false)
          }}
          onToggleHelp={() => setHelpOpen(v => !v)}
          onExport={doExport}
          onCrops={doCrops}
          onClearAsk={() => setClearAsk(true)}
        />

        <main className="relative min-h-0 flex-1">
          <AppCommandsContext value={commands}>
            <Outlet />
            {/* Floating page actions (back / reset) hover over the active view. */}
            <FloatActions />
          </AppCommandsContext>
        </main>

        <Footer />

        <LibraryDrawer open={libOpen} onClose={() => setLibOpen(false)} onRequestClear={() => setClearAsk(true)} />
        <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <HelpOverlay open={helpOpen} onClose={closeHelp} />

        <ToastHost />

        <CropDialog report={report} onClose={() => setReport(null)} />

        <ConfirmDialog
          open={clearAsk}
          title={t('Clear library?')}
          description={t('This removes all imported photos and resets all 9 workspaces to blank canvases. This cannot be undone.')}
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
      void navigate({ to: '/', replace: true })
    }
  }, [wsId, exists, navigate])

  return exists ? <Stage /> : null
}

const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: WorkspaceGrid,
})

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId',
  component: WorkspaceRoute,
})

const routeTree = rootRoute.addChildren([indexRoute, workspaceRoute])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
