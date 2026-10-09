const KEYS: [string, string][] = [
  ['V', 'Split the focused pane left/right'],
  ['S', 'Split the focused pane top/bottom'],
  ['X', 'Close the focused pane'],
  ['Tab', 'Focus the next pane'],
  ['R', 'Reset the photo in the focused pane'],
  ['L', 'Toggle the library drawer'],
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
  ['Drop a photo onto a pane', 'It goes straight into that pane (multi-select allowed; the first one is used)'],
]

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card">
        <header>
          <strong>How to use</strong>
          <button className="flat" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="intro">
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
        <div className="cols">
          <div>
            <h5>Keyboard</h5>
            <dl>
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
            <h5>Mouse / Trackpad</h5>
            <dl>
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
      </div>
    </div>
  )
}
