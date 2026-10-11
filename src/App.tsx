import type { ExportOptions } from './lib/exporter'
import { Tooltip } from '@base-ui/react/tooltip'
import { useCallback, useEffect, useState } from 'react'
import { CropDialog } from './components/CropDialog'
import { Footer } from './components/Footer'
import { HelpOverlay } from './components/HelpOverlay'
import { LibraryDrawer } from './components/LibraryDrawer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { Stage } from './components/Stage'
import ToastHost from './components/ToastHost'
import { TopBar } from './components/TopBar'
import { buildCropReport, downloadBlob, renderCollage } from './lib/exporter'
import { leafList } from './lib/panes'
import { say } from './lib/toast'
import { isTransparentBg, photoMap, useStore } from './store'
import { initTheme } from './theme'
import { usePersisted } from './usePersisted'

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

export default function App() {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)

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
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
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
      else if (k === 'd' || k === 'D') {
        if (s.focusId)
          s.removePhoto(s.focusId)
      }
      else if (k === 'h' || k === 'H' || k === 'j' || k === 'J' || k === 'k' || k === 'K' || k === 'l' || k === 'L') {
        e.preventDefault()
        const dir = k === 'h' || k === 'H' ? 'left' : k === 'l' || k === 'L' ? 'right' : k === 'k' || k === 'K' ? 'up' : 'down'
        s.focusNeighbor(dir as 'left' | 'right' | 'up' | 'down')
      }
      else if (k === 'i' || k === 'I') {
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
        if (helpOpen || libOpen || settingsOpen || report != null) {
          setHelpOpen(false)
          setLibOpen(false)
          setSettingsOpen(false)
          setReport(null)
        }
        else if (s.labelSel || s.stickerSel) {
          s.selectLabel(null)
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
        />

        <main className="relative min-h-0 flex-1">
          <Stage />
        </main>

        <Footer />

        <LibraryDrawer open={libOpen} onClose={() => setLibOpen(false)} />
        <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <HelpOverlay open={helpOpen} onClose={closeHelp} />

        <ToastHost />

        <CropDialog report={report} onClose={() => setReport(null)} />
      </div>
    </Tooltip.Provider>
  )
}
