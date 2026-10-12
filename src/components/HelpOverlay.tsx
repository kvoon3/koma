import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { T } from '@/components/ui/t'
import { useT } from '../lib/i18n'

const KEYS: [string, string][] = [
  ['H J K L', 'Focus the pane left / down / up / right'],
  ['V', 'Split the focused pane left/right (vsplit)'],
  ['S', 'Split the focused pane top/bottom (split)'],
  ['X', 'Close the focused pane'],
  ['D', 'Remove the photo from the focused pane'],
  ['Tab', 'Focus the next pane'],
  ['R', 'Reset the photo in the focused pane'],
  ['I', 'Toggle the library drawer'],
  [',', 'Settings drawer (gap / radius / blend / gap fill)'],
  ['G', 'Toggle the 3×3 workspace grid / back'],
  ['⌘E', 'Export the collage'],
  ['C', 'Export crop params (ImageMagick command)'],
  ['?', 'This help'],
  ['Enter', 'Open the highlighted grid cell (grid view only)'],
  ['Esc', 'Put the tools panel back / close drawer / deselect label / back to the grid'],
]

const MOUSE: [string, string][] = [
  ['Back button floating at the top left', 'Back to the 3×3 workspace grid (edit view only)'],
  ['Reset button floating at the top right', 'Reset to a single blank pane: the active workspace in the editor, every workspace from the grid overview (asks first); photos fall back to the library'],
  ['Two buttons at the top center of a focused pane', 'Split it top/bottom or left/right (a pane shows its buttons only while it is focused, never on hover)'],
  ['Tools panel above the footer', 'Opens by itself when the focus moves to another pane; pull it open with the handle on its top edge: pin stickers onto the focused pane\'s photo, make a sticker from text or an image, replace its photo, or add a text label (an empty pane offers only "Choose a photo")'],
  ['Drag the divider between panes', 'Resize that split; only the two adjacent panes are affected'],
  ['Drag the handle at the bottom-right of the canvas', 'Change the canvas aspect ratio (double-click to follow the first photo again)'],
  ['Drag inside a pane', 'Pan the photo; whatever falls outside the pane is cropped'],
  ['Drag a photo out of its pane', 'Carry it onto another pane to swap the two photos (an empty pane takes it in); release anywhere else to cancel'],
  ['Scroll / pinch', 'Zoom the photo around the cursor'],
  ['Pinch past the minimum zoom (or pinch an empty pane)', 'Zoom out all the way into the 3×3 grid overview'],
  ['Double-click inside a pane', 'Reset the photo in that pane'],
  ['Right-click a pane', 'Menu: split, swap its photo with the focused pane (unfocused panes), close'],
  ['Long-press a pane (touch)', 'Same menu as right-click; the tap-to-focus happens on release, so “swap with focused pane” works like a right-click'],
  ['“Choose a photo” in an empty pane', 'An empty pane is a placeholder icon: focus it and pick “Choose a photo” in the tools panel above the footer, or drop a file straight onto the pane'],
  ['Drop a photo onto a pane', 'An empty pane takes it straight in; a pane with a photo asks “Use as photo” or “Use as sticker” (multi-select allowed)'],
  ['Press and hold inside a pane', 'Play the Live Photo video (a dropped IMG_1234.HEIC + IMG_1234.MOV pair is auto-paired); release to stop; export always uses the still'],
  ['"Sticker" in the tools panel', 'Pick an image and pin it onto the focused pane\'s photo (e.g. to cover faces); click to select; handles stay pinned like labels; drag to move, corner to scale, × to delete'],
  ['"Make sticker" in the tools panel', 'Open the sticker maker: type text or pick an image, remove its background with a local AI model, pick a die-cut outline and finish, and insert the result onto that pane as a sticker'],
  ['"Text" in the tools panel', 'Add a text label to the focused pane (white on black by default); click it to select and pin its toolbar (font picker + black/white toggle, falls back to system fonts offline), drag to move, corner to resize, double-click to edit, click away or Esc to deselect'],
]

export function HelpOverlay({ open, onClose }: { open: boolean, onClose: () => void }) {
  const t = useT()
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 min-h-dvh bg-black/50 backdrop-blur-[3px] transition-opacity duration-[180ms] ease-(--ease-out) data-ending-style:duration-[140ms] data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 flex max-h-[80vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-auto border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-[180ms] ease-(--ease-out) data-ending-style:duration-[140ms] data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <header className="sticky top-0 z-1 flex items-center justify-between gap-2.5 border-b border-line bg-panel py-[11px] pl-4 pr-3">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">{t('How to use')}</Dialog.Title>
            <Dialog.Close className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border border-line bg-transparent p-0 text-[15px] leading-none text-dim transition-colors duration-[120ms] hover:border-danger hover:bg-danger hover:text-on-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1" aria-label={t('Close')}><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Dialog.Close>
          </header>
          <p className="m-0 border-b border-line px-5 py-4 text-[12.5px] leading-[1.85] text-dim [&_strong]:text-txt">
            <T k="You start with a single pane. Use the two buttons at the top center of the focused pane to **split** out more panes, and drag dividers to resize them, like panes in a terminal. That pane's tools (sticker / replace photo / text label) live in a panel above the footer, pulled open by the handle on its top edge. Each photo lives in a pane; drag / zoom inside it, and **whatever falls outside the pane is cropped away**, so arranging panes and zooming photos is all there is to cropping and stitching. Drag the bottom-right handle to change the canvas aspect ratio; it starts out following the first photo. Nine workspaces live behind the G key: the 3×3 grid shows them all, drag to reorder, click one to edit it." />
          </p>
          <div className="grid grid-cols-2 gap-[26px] px-5 py-[18px] max-[560px]:grid-cols-1 max-[560px]:gap-[18px]">
            <div>
              <h5 className="m-0 mb-2.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint">{t('Keyboard')}</h5>
              <dl className="m-0">
                {KEYS.map(([k, v]) => (
                  <div key={k} className="mb-[9px] flex items-baseline gap-2.5">
                    <dt className="m-0 flex-none basis-[104px] text-right">
                      <kbd className="rounded-none font-mono">{k}</kbd>
                    </dt>
                    <dd className="m-0 text-[12.5px] leading-[1.5] text-dim">{t(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h5 className="m-0 mb-2.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint">{t('Mouse / Trackpad')}</h5>
              <dl className="m-0">
                {MOUSE.map(([k, v]) => (
                  <div key={k} className="mb-[9px] flex items-baseline gap-2.5">
                    <dt className="m-0 flex-none basis-[104px] text-right">
                      <kbd className="rounded-none font-mono">{k}</kbd>
                    </dt>
                    <dd className="m-0 text-[12.5px] leading-[1.5] text-dim">{t(v)}</dd>
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
