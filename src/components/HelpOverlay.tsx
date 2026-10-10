import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import './help.css'

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
  ['Esc', 'Close drawer / unfocus'],
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
  ['"Text" button on a pane', 'Add a text label (black on white) — drag to move, corner to resize, double-click to edit; pick a font from the hover toolbar (falls back to system fonts offline)'],
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
        <Dialog.Backdrop className="bui-help-backdrop" />
        <Dialog.Popup className="bui-help-popup">
          <header className="bui-help-header">
            <Dialog.Title className="bui-help-title">How to use</Dialog.Title>
            <Dialog.Close className="bui-help-close" aria-label="Close"><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Dialog.Close>
          </header>
          <p className="bui-help-intro">
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
          <div className="bui-help-cols">
            <div>
              <h5 className="bui-help-h5">Keyboard</h5>
              <dl className="bui-help-dl">
                {KEYS.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h5 className="bui-help-h5">Mouse / Trackpad</h5>
              <dl className="bui-help-dl">
                {MOUSE.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{v}</dd>
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
