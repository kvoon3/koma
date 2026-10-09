import type { Theme } from '../store'
import { isTransparentBg, useStore } from '../store'

const LONG_SIDE_PRESETS = [1080, 1440, 1920, 2048, 3000, 4096, 6000]

const THEMES: { value: Theme, label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

export function SettingsDrawer({
  onClose,
  computedSize,
}: {
  onClose: () => void
  computedSize: { W: number, H: number }
}) {
  const theme = useStore(s => s.theme)
  const gap = useStore(s => s.gap)
  const radius = useStore(s => s.radius)
  const bg = useStore(s => s.bg)
  const longSide = useStore(s => s.longSide)
  const patch = useStore(s => s.patch)

  const transparent = isTransparentBg(bg)
  const mode = transparent
    ? 'transparent'
    : bg === '#000000'
      ? 'black'
      : bg === '#ffffff'
        ? 'white'
        : 'custom'

  return (
    <div className="drawer settings">
      <header>
        <strong>Settings</strong>
        <span className="spacer" />
        <button className="flat" onClick={onClose}>
          Hide
        </button>
      </header>

      <div className="settingsBody">
        <section className="sgroup">
          <h4>Appearance</h4>
          <p className="shint">
            Auto follows the system light/dark mode. Gap fill is the background showing between photos; pick Transparent to export as PNG.
          </p>
          <div className="srow">
            <span className="slbl">Theme</span>
            <div className="chips">
              {THEMES.map(t => (
                <button
                  key={t.value}
                  className={theme === t.value ? 'on' : ''}
                  onClick={() => patch({ theme: t.value })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="srow">
            <span className="slbl">Gap fill</span>
            <div className="chips">
              <button
                className={mode === 'black' ? 'on' : ''}
                onClick={() => patch({ bg: '#000000' })}
              >
                Black
              </button>
              <button
                className={mode === 'white' ? 'on' : ''}
                onClick={() => patch({ bg: '#ffffff' })}
              >
                White
              </button>
              <button
                className={mode === 'custom' ? 'on' : ''}
                onClick={() => patch({ bg: '#0f1013' })}
              >
                Custom
              </button>
              <input
                type="color"
                className="swatch"
                value={mode === 'custom' ? bg : '#0f1013'}
                onChange={e => patch({ bg: e.target.value })}
                title="Pick a custom color"
              />
              <button
                className={mode === 'transparent' ? 'on' : ''}
                onClick={() => patch({ bg: 'transparent' })}
                title="Transparent gaps (exports as PNG)"
              >
                Transparent
              </button>
            </div>
          </div>
        </section>

        <section className="sgroup">
          <h4>Layout</h4>
          <p className="shint">
            Gap is the space between photos, radius is how rounded each photo's corners are; both scale to the
            {' '}
            <strong>canvas short edge</strong>
            , and the preview matches the export.
          </p>
          <div className="srow">
            <span className="slbl">Photo gap</span>
            <input
              type="range"
              min={0}
              max={120}
              value={gap}
              onChange={e => patch({ gap: +e.target.value })}
            />
            <span className="val">
              {(gap / 10).toFixed(1)}
              %
            </span>
          </div>
          <div className="srow">
            <span className="slbl">Photo radius</span>
            <input
              type="range"
              min={0}
              max={200}
              value={radius}
              onChange={e => patch({ radius: +e.target.value })}
            />
            <span className="val">
              {(radius / 10).toFixed(1)}
              %
            </span>
          </div>
        </section>

        <section className="sgroup">
          <h4>Export</h4>
          <p className="shint">Pixel length of the exported image's long edge; the canvas scales proportionally.</p>
          <div className="srow">
            <span className="slbl">Output size</span>
            <div className="chips">
              {LONG_SIDE_PRESETS.map(v => (
                <button
                  key={v}
                  className={longSide === v ? 'on' : ''}
                  onClick={() => patch({ longSide: v })}
                >
                  {v}
                </button>
              ))}
              <input
                type="number"
                className="num"
                min={200}
                max={12000}
                step={50}
                value={longSide}
                onChange={(e) => {
                  const v = Math.max(200, Math.min(12000, Math.round(+e.target.value || 0)))
                  if (v)
                    patch({ longSide: v })
                }}
              />
              <span className="unit">px</span>
              <span className="outSize">
                →
                {' '}
                {computedSize.W}
                {' '}
                ×
                {' '}
                {computedSize.H}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
