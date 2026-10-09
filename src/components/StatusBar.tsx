import { useMemo, useRef } from 'react'
import { leafList } from '../lib/panes'
import { useStore } from '../store'

export function StatusBar({
  libOpen,
  settingsOpen,
  onToggleLib,
  onToggleSettings,
  onToggleHelp,
  onExport,
  busy,
  size,
}: {
  libOpen: boolean
  settingsOpen: boolean
  onToggleLib: () => void
  onToggleSettings: () => void
  onToggleHelp: () => void
  onExport: () => void
  busy: boolean
  size: { W: number, H: number }
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  const photos = useStore(s => s.photos.length)
  const root = useStore(s => s.root)
  const focusId = useStore(s => s.focusId)
  const addPhotos = useStore(s => s.addPhotos)

  const leaves = useMemo(() => leafList(root), [root])
  const filled = leaves.filter(l => l.photoId).length
  const focusIndex = leaves.findIndex(l => l.id === focusId)

  return (
    <footer className="statusbar">
      <div className="zone left">
        <button className="flat" onClick={() => fileRef.current?.click()}>
          + Photos
        </button>
        <button className="flat" onClick={() => dirRef.current?.click()} title="Load an entire folder at once">
          + Folder
        </button>
        <button className={`flat${libOpen ? ' on' : ''}`} onClick={onToggleLib} title="Shortcut: L">
          Library
          {photos ? <b>{photos}</b> : null}
        </button>
      </div>

      <div className="zone mid">
        <span className="kv">
          <em>Panes</em>
          {leaves.length}
        </span>
        <span className="kv">
          <em>Filled</em>
          {filled}
          /
          {leaves.length}
        </span>
        <span className={`kv${focusIndex >= 0 ? ' loud' : ''}`}>
          <em>Focus</em>
          {focusIndex >= 0 ? `#${focusIndex + 1}` : '—'}
        </span>
        <span className="kv">
          <em>Output</em>
          {size.W}
          ×
          {size.H}
        </span>
      </div>

      <div className="zone right">
        <button
          className={`flat${settingsOpen ? ' on' : ''}`}
          onClick={onToggleSettings}
          title="Shortcut: ,"
        >
          Settings
        </button>
        <button className="flat strong" onClick={onExport} disabled={busy || !filled}>
          {busy ? 'Rendering...' : 'Export'}
        </button>
        <button className="flat" onClick={onToggleHelp} title="Shortcut: ?">
          ?
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif,.hif"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files)
            addPhotos([...e.target.files])
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
            addPhotos([...e.target.files])
          e.target.value = ''
        }}
      />
    </footer>
  )
}
