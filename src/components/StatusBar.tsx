import type { ReactElement } from 'react'
import { Tooltip } from '@base-ui/react/tooltip'
import { CircleHelp, Download, FolderPlus, LayoutGrid, LoaderCircle, Moon, Plus, SlidersHorizontal, Sun } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo, useRef, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { leafList } from '../lib/panes'
import { useStore } from '../store'
import { isDarkSnapshot, subscribeTheme, toggleDark } from '../theme'

function Tip({ label, trigger }: { label: string, trigger: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6} className="pointer-events-none z-100">
          <Tooltip.Popup className="pointer-events-none rounded-none border border-line bg-panel-2 px-2 py-1 text-[11px] text-txt origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 ease-out data-starting-style:opacity-0 data-starting-style:translate-y-1 data-ending-style:opacity-0 data-ending-style:translate-y-1 data-instant:transition-none">{label}</Tooltip.Popup>
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
  const dark = useSyncExternalStore(subscribeTheme, isDarkSnapshot)

  return (
    <Tooltip.Provider delay={300}>
      <footer className="relative z-40 flex h-[calc(var(--statusH)+env(safe-area-inset-bottom))] flex-none items-stretch border-t border-line bg-statusbar px-1.5 pb-[env(safe-area-inset-bottom)] text-[11.5px] pointer-coarse:text-xs max-sm:text-xs">
        <div className="flex items-center gap-0.5">
          <Tip
            label="Add photos"
            trigger={(
              <Button onClick={() => fileRef.current?.click()} aria-label="Add photos">
                <MorphIcon icon={Plus} size={15} strokeWidth={1.75} />
                <span className="pointer-coarse:hidden max-sm:hidden">Photos</span>
              </Button>
            )}
          />
          <Tip
            label="Load an entire folder at once"
            trigger={(
              <Button onClick={() => dirRef.current?.click()} aria-label="Load an entire folder at once">
                <MorphIcon icon={FolderPlus} size={15} strokeWidth={1.75} />
                <span className="pointer-coarse:hidden max-sm:hidden">Folder</span>
              </Button>
            )}
          />
          <Tip
            label="Library · Shortcut: I"
            trigger={(
              <Button variant={libOpen ? 'on' : 'flat'} onClick={onToggleLib} aria-label="Library · Shortcut: I">
                <MorphIcon icon={LayoutGrid} size={15} strokeWidth={1.75} />
                <span className="pointer-coarse:hidden max-sm:hidden">Library</span>
                {photos ? <b>{photos}</b> : null}
              </Button>
            )}
          />
        </div>

        <div className="flex items-center gap-0.5 flex-1 justify-center gap-4 overflow-hidden pointer-coarse:gap-3 max-sm:gap-3 max-[380px]:gap-2">
          <span className="whitespace-nowrap tabular-nums text-txt [&_em]:mr-[5px] [&_em]:text-[10.5px] [&_em]:tracking-[0.06em] [&_em]:not-italic [&_em]:text-faint max-[380px]:[&_em]:mr-[3px]">
            <em>Panes</em>
            {leaves.length}
          </span>
          <span className="whitespace-nowrap tabular-nums text-txt pointer-coarse:hidden max-sm:hidden [&_em]:mr-[5px] [&_em]:text-[10.5px] [&_em]:tracking-[0.06em] [&_em]:not-italic [&_em]:text-faint max-[380px]:[&_em]:mr-[3px]">
            <em>Filled</em>
            {filled}
            /
            {leaves.length}
          </span>
          <span className={`whitespace-nowrap tabular-nums text-txt pointer-coarse:hidden max-sm:hidden [&_em]:mr-[5px] [&_em]:text-[10.5px] [&_em]:tracking-[0.06em] [&_em]:not-italic [&_em]:text-faint max-[380px]:[&_em]:mr-[3px]${focusIndex >= 0 ? ' text-accent' : ''}`}>
            <em>Focus</em>
            {focusIndex >= 0 ? `#${focusIndex + 1}` : '—'}
          </span>
          <span className="whitespace-nowrap tabular-nums text-txt [&_em]:mr-[5px] [&_em]:text-[10.5px] [&_em]:tracking-[0.06em] [&_em]:not-italic [&_em]:text-faint max-[380px]:[&_em]:mr-[3px]">
            <em>Output</em>
            {size.W}
            ×
            {size.H}
          </span>
        </div>

        <div className="flex items-center gap-0.5 justify-end gap-[5px]">
          <Tip
            label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            trigger={(
              <Button
                onClick={toggleDark}
                aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                <MorphIcon icon={dark ? Sun : Moon} size={15} strokeWidth={1.75} />
              </Button>
            )}
          />
          <Tip
            label="Settings · Shortcut: ,"
            trigger={(
              <Button
                variant={settingsOpen ? 'on' : 'flat'}
                onClick={onToggleSettings}
                aria-label="Settings · Shortcut: ,"
              >
                <MorphIcon icon={SlidersHorizontal} size={15} strokeWidth={1.75} />
                <span className="pointer-coarse:hidden max-sm:hidden">Settings</span>
              </Button>
            )}
          />
          <Tip
            label="Export image"
            trigger={(
              <Button variant="strong" onClick={onExport} disabled={busy || !filled} aria-label="Export image">
                <MorphIcon icon={busy ? LoaderCircle : Download} size={15} strokeWidth={1.75} className={busy ? 'animate-spin [animation-duration:900ms]' : undefined} />
                <span className="pointer-coarse:hidden max-sm:hidden">{busy ? 'Rendering' : 'Export'}</span>
              </Button>
            )}
          />
          <Tip
            label="Keyboard shortcuts · Shortcut: ?"
            trigger={(
              <Button onClick={onToggleHelp} aria-label="Keyboard shortcuts · Shortcut: ?">
                <MorphIcon icon={CircleHelp} size={15} strokeWidth={1.75} />
              </Button>
            )}
          />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif,.hif,.mov"
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
