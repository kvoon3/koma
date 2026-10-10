import { Drawer } from '@base-ui/react/drawer'
import { NumberField } from '@base-ui/react/number-field'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Select } from '@base-ui/react/select'
import { Slider } from '@base-ui/react/slider'
import { Switch } from '@base-ui/react/switch'
import { Check, ChevronDown, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { outputSizeFor } from '../lib/exporter'
import { mirrorEnabled, setMirrorEnabled } from '../lib/fonts'
import { isTransparentBg, useStore } from '../store'
import './drawers.css'

const LONG_SIDE_PRESETS = [1080, 1440, 1920, 2048, 3000, 4096, 6000]
const PRESET_ITEMS = LONG_SIDE_PRESETS.map(v => ({ label: String(v), value: v }))
const CUSTOM_BG = '#18181b'

type BgMode = 'black' | 'white' | 'transparent' | 'custom'

export function SettingsDrawer({ open, onClose }: { open: boolean, onClose: () => void }) {
  const gap = useStore(s => s.gap)
  const radius = useStore(s => s.radius)
  const bg = useStore(s => s.bg)
  const longSide = useStore(s => s.longSide)
  const canvasRatio = useStore(s => s.canvasRatio)
  const patch = useStore(s => s.patch)
  const [mirror, setMirror] = useState(() => mirrorEnabled())

  const ratio = canvasRatio ?? 1.5
  const size = outputSizeFor(longSide, ratio)

  const mode: BgMode = isTransparentBg(bg)
    ? 'transparent'
    : bg === '#000000'
      ? 'black'
      : bg === '#ffffff'
        ? 'white'
        : 'custom'

  const setMode = (next: BgMode) => {
    if (next === 'black')
      patch({ bg: '#000000' })
    else if (next === 'white')
      patch({ bg: '#ffffff' })
    else if (next === 'transparent')
      patch({ bg: 'transparent' })
    else
      patch({ bg: CUSTOM_BG })
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
      swipeDirection="down"
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="bui-drawer-backdrop" />
        <Drawer.Viewport className="bui-drawer-viewport">
          <Drawer.Popup className="bui-drawer-popup bui-drawer-popup-settings">
            <Drawer.Content className="bui-drawer-content">
              <header className="bui-drawer-head">
                <Drawer.Title className="bui-drawer-title">Settings</Drawer.Title>
                <span className="bui-drawer-spacer" />
                <Drawer.Close className="flat bui-drawer-close" aria-label="Hide settings"><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Drawer.Close>
              </header>

              <div className="bui-drawer-body">
                <section className="bui-drawer-group">
                  <h4>Appearance</h4>
                  <p>
                    Theme follows the system or the toggle in the status bar. Gap fill is the background showing
                    between photos; pick Transparent to export as PNG.
                  </p>
                  <div className="bui-drawer-row">
                    <span className="bui-drawer-lbl">Gap fill</span>
                    <RadioGroup
                      className="bui-drawer-swatches"
                      aria-label="Gap fill"
                      value={mode}
                      onValueChange={next => setMode(next)}
                    >
                      <Radio.Root value="black" aria-label="Black" className="bui-drawer-swatch is-black">
                        <Radio.Indicator className="bui-drawer-swatch-dot" />
                      </Radio.Root>
                      <Radio.Root value="white" aria-label="White" className="bui-drawer-swatch is-white">
                        <Radio.Indicator className="bui-drawer-swatch-dot" />
                      </Radio.Root>
                      <Radio.Root value="transparent" aria-label="Transparent" className="bui-drawer-swatch is-clear">
                        <Radio.Indicator className="bui-drawer-swatch-dot" />
                      </Radio.Root>
                      <input
                        type="color"
                        className="bui-drawer-color"
                        aria-label="Custom gap fill"
                        title="Pick a custom color"
                        value={mode === 'custom' ? bg : CUSTOM_BG}
                        onChange={e => patch({ bg: e.target.value })}
                      />
                      {mode === 'custom' && <span className="bui-drawer-custom-tag">Custom</span>}
                    </RadioGroup>
                  </div>
                </section>

                <section className="bui-drawer-group">
                  <h4>Layout</h4>
                  <p>
                    Gap is the space between photos, radius is how rounded each photo's corners are; both scale to the
                    {' '}
                    <strong>canvas short edge</strong>
                    , and the preview matches the export.
                  </p>
                  <div className="bui-drawer-row">
                    <span className="bui-drawer-lbl">Photo gap</span>
                    <Slider.Root
                      className="bui-drawer-slider"
                      min={0}
                      max={120}
                      value={gap}
                      onValueChange={v => patch({ gap: v })}
                    >
                      <Slider.Control className="bui-drawer-slider-control">
                        <Slider.Track className="bui-drawer-slider-track">
                          <Slider.Indicator className="bui-drawer-slider-indicator" />
                          <Slider.Thumb className="bui-drawer-slider-thumb" aria-label="Photo gap" />
                        </Slider.Track>
                      </Slider.Control>
                    </Slider.Root>
                    <span className="bui-drawer-val">
                      {(gap / 10).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div className="bui-drawer-row">
                    <span className="bui-drawer-lbl">Photo radius</span>
                    <Slider.Root
                      className="bui-drawer-slider"
                      min={0}
                      max={200}
                      value={radius}
                      onValueChange={v => patch({ radius: v })}
                    >
                      <Slider.Control className="bui-drawer-slider-control">
                        <Slider.Track className="bui-drawer-slider-track">
                          <Slider.Indicator className="bui-drawer-slider-indicator" />
                          <Slider.Thumb className="bui-drawer-slider-thumb" aria-label="Photo radius" />
                        </Slider.Track>
                      </Slider.Control>
                    </Slider.Root>
                    <span className="bui-drawer-val">
                      {(radius / 10).toFixed(1)}
                      %
                    </span>
                  </div>
                </section>

                <section className="bui-drawer-group">
                  <h4>Fonts</h4>
                  <div className="bui-drawer-row">
                    <span className="bui-drawer-lbl-wide">Font mirror (fonts.loli.net)</span>
                    <Switch.Root
                      className="bui-drawer-switch"
                      aria-label="Font mirror"
                      checked={mirror}
                      onCheckedChange={(checked) => {
                        setMirror(checked)
                        setMirrorEnabled(checked)
                      }}
                    >
                      <Switch.Thumb className="bui-drawer-switch-thumb" />
                    </Switch.Root>
                  </div>
                  <p>Fallback CDN for Google Fonts when fonts.googleapis.com is unreachable.</p>
                </section>

                <section className="bui-drawer-group">
                  <h4>Export</h4>
                  <p>Pixel length of the exported image's long edge; the canvas scales proportionally.</p>
                  <div className="bui-drawer-row">
                    <span className="bui-drawer-lbl">Output size</span>
                    <Select.Root
                      items={PRESET_ITEMS}
                      value={longSide}
                      onValueChange={(value) => {
                        const next = Number(value)
                        if (Number.isFinite(next))
                          patch({ longSide: next })
                      }}
                    >
                      <Select.Trigger className="bui-drawer-select" aria-label="Output size preset">
                        <Select.Value placeholder="Custom" />
                        <Select.Icon className="bui-drawer-select-icon">
                          <MorphIcon icon={ChevronDown} size={13} strokeWidth={1.75} />
                        </Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Positioner
                          className="bui-drawer-positioner"
                          sideOffset={4}
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <Select.Popup className="bui-drawer-menu">
                            <Select.List className="bui-drawer-menu-list">
                              {LONG_SIDE_PRESETS.map(v => (
                                <Select.Item key={v} value={v} className="bui-drawer-menu-item">
                                  <Select.ItemIndicator className="bui-drawer-item-indicator">
                                    <MorphIcon icon={Check} size={13} strokeWidth={2} />
                                  </Select.ItemIndicator>
                                  <Select.ItemText className="bui-drawer-item-text">{v}</Select.ItemText>
                                </Select.Item>
                              ))}
                            </Select.List>
                          </Select.Popup>
                        </Select.Positioner>
                      </Select.Portal>
                    </Select.Root>
                    <NumberField.Root
                      className="bui-drawer-num"
                      value={longSide}
                      min={200}
                      max={12000}
                      step={50}
                      onValueChange={(value) => {
                        if (value != null && value >= 200 && value <= 12000)
                          patch({ longSide: Math.round(value) })
                      }}
                    >
                      <NumberField.Group className="bui-drawer-num-group">
                        <NumberField.Decrement className="bui-drawer-num-dec" aria-label="Decrease output size">
                          −
                        </NumberField.Decrement>
                        <NumberField.Input className="bui-drawer-num-input" aria-label="Custom output size" />
                        <NumberField.Increment className="bui-drawer-num-inc" aria-label="Increase output size">
                          +
                        </NumberField.Increment>
                      </NumberField.Group>
                    </NumberField.Root>
                    <span className="bui-drawer-unit">px</span>
                    <span className="bui-drawer-out">
                      →
                      {' '}
                      {size.W}
                      {' '}
                      ×
                      {' '}
                      {size.H}
                    </span>
                  </div>
                </section>
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
