import type { ExportOptions } from './lib/exporter'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CropDialog } from './components/CropDialog'
import { HelpOverlay } from './components/HelpOverlay'
import { LibraryDrawer } from './components/LibraryDrawer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { Stage } from './components/Stage'
import { StatusBar } from './components/StatusBar'
import ToastHost from './components/ToastHost'
import { buildCropReport, downloadBlob, outputSizeFor, renderCollage } from './lib/exporter'
import { leafList } from './lib/panes'
import { say } from './lib/toast'
import { isTransparentBg, photoMap, useStore } from './store'
import { usePersisted } from './usePersisted'
import { useTheme } from './useTheme'

function exportOptions(): ExportOptions {
  const s = useStore.getState()
  return {
    root: s.root,
    ratio: s.canvasRatio ?? 1.5,
    gap: s.gap,
    radius: s.radius,
    bg: s.bg,
    photos: photoMap(s.photos),
    longSide: s.longSide,
  }
}

const sizeFor = outputSizeFor

export default function App() {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)

  const [libOpen, setLibOpen] = usePersisted('libOpen', false)
  const [settingsOpen, setSettingsOpen] = usePersisted('settingsOpen', false)
  const [helpOpen, setHelpOpen] = useState(false)

  useTheme()

  const stickerPick = useStore(s => s.stickerPick)
  useEffect(() => {
    if (stickerPick) {
      setLibOpen(true)
      setSettingsOpen(false)
    }
  }, [stickerPick, setLibOpen, setSettingsOpen])

  const longSide = useStore(s => s.longSide)
  const canvasRatio = useStore(s => s.canvasRatio)
  const ratio = canvasRatio ?? 1.5
  const size = useMemo(() => sizeFor(longSide, ratio), [longSide, ratio])

  const hasPhotos = useStore(s => s.photos.length > 0)

  const doExport = useCallback(async () => {
    setBusy(true)
    say('Rendering at original resolution...')
    try {
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
      say(`Exported ${canvas.width} × ${canvas.height} (${ext.toUpperCase()})`)
      canvas.width = canvas.height = 0
    }
    catch (e) {
      say(`Export failed: ${(e as Error).message}`)
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
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
        return

      const s = useStore.getState()
      const leaves = leafList(s.root)
      const k = e.key

      if (k === 'v' || k === 'V') {
        if (s.focusId)
          s.split(s.focusId, 'row')
      }
      else if (k === 's' || k === 'S') {
        if (s.focusId)
          s.split(s.focusId, 'column')
      }
      else if (k === 'x' || k === 'X') {
        if (s.focusId)
          s.closePane(s.focusId)
      }
      else if (k === 'l' || k === 'L') {
        e.preventDefault()
        setLibOpen(v => !v)
        setSettingsOpen(false)
      }
      else if (k === ',') {
        e.preventDefault()
        setSettingsOpen(v => !v)
        setLibOpen(false)
      }
      else if (k === '?') {
        e.preventDefault()
        setHelpOpen(v => !v)
      }
      else if (k === 'Tab') {
        e.preventDefault()
        if (!leaves.length)
          return
        const i = leaves.findIndex(l => l.id === s.focusId)
        s.focus(leaves[(i + 1 + leaves.length) % leaves.length].id)
      }
      else if (k === 'r' || k === 'R') {
        if (s.focusId)
          s.updateLeaf(s.focusId, { zoom: 1, cx: 0.5, cy: 0.5 })
      }
      else if (k === 'c' || k === 'C') {
        doCrops()
      }
      else if (k === 'Escape') {
        if (helpOpen || libOpen || settingsOpen || report != null || s.stickerPick) {
          setHelpOpen(false)
          setLibOpen(false)
          setSettingsOpen(false)
          setReport(null)
          s.cancelStickerPick()
        }
        else {
          s.focus('')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [helpOpen, libOpen, settingsOpen, report, setLibOpen, setSettingsOpen, doExport, doCrops])

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length)
        return
      e.preventDefault()
      const created = useStore.getState().addPhotos(files)
      say(created.length ? `Added ${created.length} photos` : 'No image files found')
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
    <div className="app">
      <main className="main">
        <Stage />
        {!hasPhotos && !helpOpen && (
          <div className="welcome">
            <h2>Drop photos here</h2>
            <p>Or click "+ Photos / + Folder" in the status bar. Photos stay on your device and are never uploaded.</p>
            <ul>
              <li>
                The two buttons at the top center of a pane
                {' -> '}
                <b>split top/bottom or left/right</b>
              </li>
              <li>
                Drag the
                {' '}
                <b>divider</b>
                {' '}
                to resize sections
              </li>
              <li>
                Inside a pane,
                {' '}
                <b>drag / scroll to zoom</b>
                {' -> '}
                anything outside is cropped automatically
              </li>
              <li>
                <kbd>V</kbd>
                {' '}
                split left/right ·
                <kbd>S</kbd>
                {' '}
                split top/bottom ·
                <kbd>L</kbd>
                {' '}
                library ·
                {' '}
                <kbd>,</kbd>
                {' '}
                settings ·
                <kbd>?</kbd>
                {' '}
                all shortcuts
              </li>
            </ul>
          </div>
        )}
      </main>

      <StatusBar
        libOpen={libOpen}
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
        busy={busy}
        size={size}
      />

      <LibraryDrawer open={libOpen} onClose={() => setLibOpen(false)} />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <HelpOverlay open={helpOpen} onClose={closeHelp} />

      <ToastHost />

      <CropDialog report={report} onClose={() => setReport(null)} />
    </div>
  )
}
