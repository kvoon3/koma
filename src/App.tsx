import type { Dispatch, SetStateAction } from 'react'
import type { ExportOptions } from './lib/exporter'
import { Tooltip } from '@base-ui/react/tooltip'
import { useCallback, useEffect, useState } from 'react'
import { ClearConfirm } from './components/ClearConfirm'
import { CropDialog } from './components/CropDialog'
import { Footer } from './components/Footer'
import { HelpOverlay } from './components/HelpOverlay'
import { LibraryDrawer } from './components/LibraryDrawer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { Stage } from './components/Stage'
import ToastHost from './components/ToastHost'
import { TopBar } from './components/TopBar'
import { WorkspaceGrid } from './components/WorkspaceGrid'
import { buildCropReport, downloadBlob, renderCollage } from './lib/exporter'
import { t } from './lib/i18n'
import { leafList } from './lib/panes'
import { say } from './lib/toast'
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
    photos: photoMap(s.photos),
    longSide: s.longSide,
  }
}

/** One export per non-empty workspace, in grid order, named by position. */
async function exportGrid() {
  const s = useStore.getState()
  const filled = s.workspaces.filter(w => leafList(w.root).some(l => l.photoId))
  for (let i = 0; i < filled.length; i++) {
    const ws = filled[i]
    say(t('Rendering {n} / {total}...', { n: i + 1, total: filled.length }))
    const canvas = await renderCollage({
      root: ws.root,
      ratio: ws.canvasRatio ?? 1.5,
      gap: s.gap,
      radius: s.radius,
      bg: s.bg,
      photos: photoMap(s.photos),
      longSide: s.longSide,
    })
    const format = isTransparentBg(s.bg) ? 'image/png' : s.format
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, format, s.quality))
    if (!blob)
      throw new Error('Failed to create image')
    const ext = format === 'image/png' ? 'png' : 'jpg'
    const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
    // Position among the filled workspaces at export time, 1-based.
    const pos = s.workspaces.indexOf(ws) + 1
    downloadBlob(blob, `collage_${pos}_${canvas.width}x${canvas.height}_${stamp}.${ext}`)
    canvas.width = canvas.height = 0
  }
  say(filled.length === 1 ? t('Exported {n} image', { n: 1 }) : t('Exported {n} images', { n: filled.length }))
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
    s.focus('')
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

    case 'Tab':
      e.preventDefault()
      focusNextLeaf(s, ws)
      break

    case 'c':
      ui.doCrops()
      break

    case 'Escape':
      handleEscapeKey(s, ui)
      break
  }
}

export default function App() {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [clearAsk, setClearAsk] = useState(false)

  const [libOpen, setLibOpen] = usePersisted('libOpen', false)
  const [settingsOpen, setSettingsOpen] = usePersisted('settingsOpen', false)
  const [helpOpen, setHelpOpen] = useState(false)

  const view = useStore(s => s.view)

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
      if (useStore.getState().view === 'grid') {
        await exportGrid()
      }
      else {
        const opts = exportOptions()
        const canvas = await renderCollage(opts)
        const s = useStore.getState()
        const format = isTransparentBg(s.bg) ? 'image/png' : s.format
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, format, s.quality))
        if (!blob)
          throw new Error('Failed to create image')
        const ext = format === 'image/png' ? 'png' : 'jpg'
        const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
        downloadBlob(blob, `collage_${canvas.width}x${canvas.height}_${stamp}.${ext}`)
        say(t('Exported {w} × {h} ({ext})', { w: canvas.width, h: canvas.height, ext: ext.toUpperCase() }))
        canvas.width = canvas.height = 0
      }
    }
    catch (e) {
      say(t('Export failed: {msg}', { msg: (e as Error).message }))
    }
    finally {
      setBusy(false)
    }
  }, [])

  const doCrops = useCallback(() => setReport(buildCropReport(exportOptions())), [])

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
      const grid = s.view === 'grid'
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
      }

      if (k === 'G' || k === 'g') {
        e.preventDefault()
        s.toggleGrid()
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
  }, [helpOpen, libOpen, settingsOpen, report, setLibOpen, setSettingsOpen, doExport, doCrops])

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      // Grid view is pure navigation: drops are ignored there.
      if (useStore.getState().view === 'grid')
        return
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length)
        return
      e.preventDefault()
      const created = useStore.getState().addPhotos(files)
      say(created.length ? t('Added {n} photos', { n: created.length }) : t('No image files found'))
      if (created.length)
        setLibOpen(true)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [setLibOpen])

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
          {view === 'grid'
            ? <WorkspaceGrid />
            : <Stage />}
        </main>

        <Footer />

        <LibraryDrawer open={libOpen} onClose={() => setLibOpen(false)} onRequestClear={() => setClearAsk(true)} />
        <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <HelpOverlay open={helpOpen} onClose={closeHelp} />

        <ToastHost />

        <CropDialog report={report} onClose={() => setReport(null)} />

        <ClearConfirm
          open={clearAsk}
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
