import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'

const KEYS: [string, string][] = [
  ['H J K L', 'Focus the pane left / down / up / right'],
  ['V', 'Split the focused pane left/right (vsplit)'],
  ['S', 'Split the focused pane top/bottom (split)'],
  ['X', 'Close the focused pane'],
  ['D', 'Remove the photo from the focused pane'],
  ['Tab', 'Focus the next pane'],
  ['R', 'Reset the photo in the focused pane'],
  ['I', 'Toggle the library drawer'],
  [',', 'Settings drawer (gap / radius / gap fill / export size)'],
  ['⌘E', 'Export the collage'],
  ['C', 'Export crop params (ImageMagick command)'],
  ['?', 'This help'],
  ['Esc', 'Close drawer / deselect label / unfocus'],
]

const MOUSE: [string, string][] = [
  ['Two buttons at the top center of a pane', 'Split top/bottom or left/right (they appear on hover)'],
  ['Drag the divider between panes', 'Resize that split; only the two adjacent panes are affected'],
  ['Drag the handle at the bottom-right of the canvas', 'Change the canvas aspect ratio (double-click to follow the first photo again)'],
  ['Drag inside a pane', 'Pan the photo — whatever falls outside the pane is cropped'],
  ['Scroll / pinch', 'Zoom the photo around the cursor'],
  ['Double-click inside a pane', 'Reset the photo in that pane'],
  ['Right-click an unfocused pane', 'Menu: swap its photo with the focused pane'],
  ['Drop a photo onto a pane', 'It goes straight into that pane (multi-select allowed; the first one is used)'],
  ['Press and hold inside a pane', 'Play the Live Photo video (a dropped IMG_1234.HEIC + IMG_1234.MOV pair is auto-paired); release to stop — export always uses the still'],
  ['"Text" button on a pane', 'Add a text label (black on white) — click it to select and pin its toolbar (font picker, falls back to system fonts offline), drag to move, corner to resize, double-click to edit, click away or Esc to deselect'],
]

export function HelpOverlay({ open, onClose }: { open: boolean, onClose: () => void }) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 min-h-dvh bg-black/50 backdrop-blur-[3px] transition-opacity duration-[120ms] data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 flex max-h-[80vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-auto border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-[120ms] data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <header className="sticky top-0 z-1 flex items-center justify-between gap-2.5 border-b border-line bg-panel py-[11px] pl-4 pr-3">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">How to use</Dialog.Title>
            <Dialog.Close className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border border-line bg-transparent p-0 text-[15px] leading-none text-dim transition-colors duration-[120ms] hover:border-danger hover:bg-danger hover:text-on-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1" aria-label="Close"><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Dialog.Close>
          </header>
          <p className="m-0 border-b border-line px-5 py-4 text-[12.5px] leading-[1.85] text-dim [&_strong]:text-txt">
            You start with a single pane. Use the two buttons at the top center of a pane to
            {' '}
            <strong>split</strong>
            {' '}
            out more panes,
            and drag dividers to resize them — like panes in a terminal.
            Each photo lives in a pane; drag / zoom inside it, and
            {' '}
            <strong>whatever falls outside the pane is cropped away</strong>
            ,
            so arranging panes and zooming photos is all there is to cropping and stitching.
            Drag the bottom-right handle to change the canvas aspect ratio; it starts out following the first photo.
          </p>
          <div className="grid grid-cols-2 gap-[26px] px-5 py-[18px] max-[560px]:grid-cols-1 max-[560px]:gap-[18px]">
            <div>
              <h5 className="m-0 mb-2.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint">Keyboard</h5>
              <dl className="m-0">
                {KEYS.map(([k, v]) => (
                  <div key={k} className="mb-[9px] flex items-baseline gap-2.5">
                    <dt className="m-0 flex-none basis-[104px] text-right">
                      <kbd className="rounded-none font-mono">{k}</kbd>
                    </dt>
                    <dd className="m-0 text-[12.5px] leading-[1.5] text-dim">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h5 className="m-0 mb-2.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint">Mouse / Trackpad</h5>
              <dl className="m-0">
                {MOUSE.map(([k, v]) => (
                  <div key={k} className="mb-[9px] flex items-baseline gap-2.5">
                    <dt className="m-0 flex-none basis-[104px] text-right">
                      <kbd className="rounded-none font-mono">{k}</kbd>
                    </dt>
                    <dd className="m-0 text-[12.5px] leading-[1.5] text-dim">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
