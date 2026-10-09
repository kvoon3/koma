import type { ReactElement } from 'react'
import { Tooltip } from '@base-ui/react/tooltip'
import { useMemo, useRef } from 'react'
import { leafList } from '../lib/panes'
import { useStore } from '../store'
import './statusbar.css'

function Tip({ label, trigger }: { label: string, trigger: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6} className="bui-tip-positioner">
          <Tooltip.Popup className="bui-tip-popup">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

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
    <Tooltip.Provider delay={300}>
      <footer className="statusbar">
        <div className="zone left">
          <Tip
            label="Add photos"
            trigger={(
              <button className="flat" onClick={() => fileRef.current?.click()} aria-label="Add photos">
                + Photos
              </button>
            )}
          />
          <Tip
            label="Load an entire folder at once"
            trigger={(
              <button className="flat" onClick={() => dirRef.current?.click()} aria-label="Load an entire folder at once">
                + Folder
              </button>
            )}
          />
          <Tip
            label="Library · Shortcut: L"
            trigger={(
              <button className={`flat${libOpen ? ' on' : ''}`} onClick={onToggleLib} aria-label="Library · Shortcut: L">
                Library
                {photos ? <b>{photos}</b> : null}
              </button>
            )}
          />
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
          <Tip
            label="Settings · Shortcut: ,"
            trigger={(
              <button
                className={`flat${settingsOpen ? ' on' : ''}`}
                onClick={onToggleSettings}
                aria-label="Settings · Shortcut: ,"
              >
                Settings
              </button>
            )}
          />
          <Tip
            label="Export image"
            trigger={(
              <button className="flat strong" onClick={onExport} disabled={busy || !filled} aria-label="Export image">
                {busy ? 'Rendering...' : 'Export'}
              </button>
            )}
          />
          <Tip
            label="Keyboard shortcuts · Shortcut: ?"
            trigger={(
              <button className="flat" onClick={onToggleHelp} aria-label="Keyboard shortcuts · Shortcut: ?">
                ?
              </button>
            )}
          />
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
    </Tooltip.Provider>
  )
}
