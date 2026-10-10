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
import { buttonBase, buttonVariants } from '@/components/ui/button'
import { outputSizeFor } from '../lib/exporter'
import { mirrorEnabled, setMirrorEnabled } from '../lib/fonts'
import { isTransparentBg, useStore } from '../store'

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
        <Drawer.Backdrop className="fixed inset-0 z-44 min-h-dvh bg-overlay-dim opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]" />
        <Drawer.Viewport className="fixed inset-0 z-45 flex items-end justify-center">
          <Drawer.Popup className="relative box-border flex max-h-[min(46vh,420px)] w-[min(920px,100vw)] flex-col overflow-hidden rounded-none border border-b-0 border-line bg-drawer-bg text-txt shadow-pop outline-0 translate-y-[var(--drawer-swipe-movement-y,0px)] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform mb-[calc(var(--statusH)+env(safe-area-inset-bottom))] pointer-coarse:max-h-[62dvh] max-sm:max-h-[62dvh] data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:translate-y-[calc(100%+var(--statusH))] data-ending-style:translate-y-[calc(100%+var(--statusH))]">
            <Drawer.Content className="flex min-h-0 flex-1 flex-col outline-0">
              <header className="flex flex-none items-center gap-2.5 py-1.5 pl-3.5 pr-2.5">
                <Drawer.Title className="m-0 text-[12.5px] font-bold">Settings</Drawer.Title>
                <span className="flex-1" />
                <Drawer.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label="Hide settings"><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Drawer.Close>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] pt-1 pb-3 pointer-coarse:px-3.5 pointer-coarse:pt-3 pointer-coarse:pb-4 max-sm:px-3.5 max-sm:pt-3 max-sm:pb-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-strip-thumb">
                <section className="flex flex-col gap-[7px]">
                  <h4 className="m-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint">Appearance</h4>
                  <p className="m-0 text-[11.5px] text-faint">
                    Theme follows the system or the toggle in the status bar. Gap fill is the background showing
                    between photos; pick Transparent to export as PNG.
                  </p>
                  <div className="flex items-center gap-3.5">
                    <span className="flex-none basis-[68px] text-xs text-dim">Gap fill</span>
                    <RadioGroup
                      className="flex flex-wrap items-center gap-1.5"
                      aria-label="Gap fill"
                      value={mode}
                      onValueChange={next => setMode(next)}
                    >
                      <Radio.Root value="black" aria-label="Black" className="box-border grid h-[26px] w-[30px] cursor-pointer place-items-center rounded-none border border-line bg-black p-0 data-checked:border-accent data-checked:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1">
                        <Radio.Indicator className="h-2.5 w-2.5 bg-accent shadow-[0_0_0_2px_var(--drawerBg)]" />
                      </Radio.Root>
                      <Radio.Root value="white" aria-label="White" className="box-border grid h-[26px] w-[30px] cursor-pointer place-items-center rounded-none border border-line bg-white p-0 data-checked:border-accent data-checked:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1">
                        <Radio.Indicator className="h-2.5 w-2.5 bg-accent shadow-[0_0_0_2px_var(--drawerBg)]" />
                      </Radio.Root>
                      <Radio.Root value="transparent" aria-label="Transparent" className="box-border grid h-[26px] w-[30px] cursor-pointer place-items-center rounded-none border border-line swatch-clear p-0 data-checked:border-accent data-checked:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1">
                        <Radio.Indicator className="h-2.5 w-2.5 bg-accent shadow-[0_0_0_2px_var(--drawerBg)]" />
                      </Radio.Root>
                      <input
                        type="color"
                        className="box-border h-[26px] w-9 cursor-pointer rounded-none border border-line bg-panel-2 p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0"
                        aria-label="Custom gap fill"
                        title="Pick a custom color"
                        value={mode === 'custom' ? bg : CUSTOM_BG}
                        onChange={e => patch({ bg: e.target.value })}
                      />
                      {mode === 'custom' && <span className="text-[11.5px] text-faint">Custom</span>}
                    </RadioGroup>
                  </div>
                </section>

                <section className="flex flex-col gap-[7px]">
                  <h4 className="m-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint">Layout</h4>
                  <p className="m-0 text-[11.5px] text-faint">
                    Gap is the space between photos, radius is how rounded each photo's corners are; both scale to the
                    {' '}
                    <strong>canvas short edge</strong>
                    , and the preview matches the export.
                  </p>
                  <div className="flex items-center gap-3.5">
                    <span className="flex-none basis-[68px] text-xs text-dim">Photo gap</span>
                    <Slider.Root
                      className="flex-none basis-[210px]"
                      min={0}
                      max={120}
                      value={gap}
                      onValueChange={v => patch({ gap: v })}
                    >
                      <Slider.Control className="flex touch-none select-none items-center py-2">
                        <Slider.Track className="relative h-1.5 w-full bg-panel-2 shadow-[inset_0_0_0_1px_var(--line)] select-none">
                          <Slider.Indicator className="bg-accent" />
                          <Slider.Thumb className="box-border h-3 w-3 select-none rounded-none border border-accent bg-panel has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2" aria-label="Photo gap" />
                        </Slider.Track>
                      </Slider.Control>
                    </Slider.Root>
                    <span className="flex-none basis-[46px] text-xs text-accent tabular-nums">
                      {(gap / 10).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div className="flex items-center gap-3.5">
                    <span className="flex-none basis-[68px] text-xs text-dim">Photo radius</span>
                    <Slider.Root
                      className="flex-none basis-[210px]"
                      min={0}
                      max={200}
                      value={radius}
                      onValueChange={v => patch({ radius: v })}
                    >
                      <Slider.Control className="flex touch-none select-none items-center py-2">
                        <Slider.Track className="relative h-1.5 w-full bg-panel-2 shadow-[inset_0_0_0_1px_var(--line)] select-none">
                          <Slider.Indicator className="bg-accent" />
                          <Slider.Thumb className="box-border h-3 w-3 select-none rounded-none border border-accent bg-panel has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2" aria-label="Photo radius" />
                        </Slider.Track>
                      </Slider.Control>
                    </Slider.Root>
                    <span className="flex-none basis-[46px] text-xs text-accent tabular-nums">
                      {(radius / 10).toFixed(1)}
                      %
                    </span>
                  </div>
                </section>

                <section className="flex flex-col gap-[7px]">
                  <h4 className="m-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint">Fonts</h4>
                  <div className="flex items-center gap-3.5">
                    <span className="flex-none text-xs text-dim">Font mirror (fonts.loli.net)</span>
                    <Switch.Root
                      className="group/switch relative box-border inline-flex h-5 w-[34px] cursor-pointer rounded-none border border-line bg-panel-2 p-0 transition-colors duration-[120ms] data-checked:border-accent data-checked:bg-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2"
                      aria-label="Font mirror"
                      checked={mirror}
                      onCheckedChange={(checked) => {
                        setMirror(checked)
                        setMirrorEnabled(checked)
                      }}
                    >
                      <Switch.Thumb className="block m-0.5 h-3.5 w-3.5 rounded-none bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-[120ms] group-data-checked/switch:translate-x-3.5" />
                    </Switch.Root>
                  </div>
                  <p className="m-0 text-[11.5px] text-faint">Fallback CDN for Google Fonts when fonts.googleapis.com is unreachable.</p>
                </section>

                <section className="flex flex-col gap-[7px]">
                  <h4 className="m-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint">Export</h4>
                  <p className="m-0 text-[11.5px] text-faint">Pixel length of the exported image's long edge; the canvas scales proportionally.</p>
                  <div className="flex items-center gap-3.5">
                    <span className="flex-none basis-[68px] text-xs text-dim">Output size</span>
                    <Select.Root
                      items={PRESET_ITEMS}
                      value={longSide}
                      onValueChange={(value) => {
                        const next = Number(value)
                        if (Number.isFinite(next))
                          patch({ longSide: next })
                      }}
                    >
                      <Select.Trigger className="box-border inline-flex h-[26px] min-w-[108px] cursor-pointer items-center justify-between gap-2.5 rounded-none border border-line bg-panel-2 px-2 text-xs text-txt hover:bg-chip-hover focus-visible:outline-1 focus-visible:outline-accent" aria-label="Output size preset">
                        <Select.Value placeholder="Custom" />
                        <Select.Icon className="flex text-dim">
                          <MorphIcon icon={ChevronDown} size={13} strokeWidth={1.75} />
                        </Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Positioner
                          className="z-[260] select-none outline-0"
                          sideOffset={4}
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <Select.Popup className="box-border min-w-[var(--anchor-width)] rounded-none border border-line bg-panel py-1 text-txt outline-0 shadow-[0_12px_32px_rgba(0,0,0,0.45)] data-starting-style:opacity-0 data-ending-style:opacity-0">
                            <Select.List className="relative max-h-[var(--available-height)] overflow-y-auto">
                              {LONG_SIDE_PRESETS.map(v => (
                                <Select.Item key={v} value={v} className="flex cursor-default select-none items-center gap-2 px-2.5 py-[5px] text-xs outline-0 data-highlighted:bg-accent data-highlighted:text-on-accent">
                                  <Select.ItemIndicator className="flex w-3.5 text-current">
                                    <MorphIcon icon={Check} size={13} strokeWidth={2} />
                                  </Select.ItemIndicator>
                                  <Select.ItemText className="flex-1">{v}</Select.ItemText>
                                </Select.Item>
                              ))}
                            </Select.List>
                          </Select.Popup>
                        </Select.Positioner>
                      </Select.Portal>
                    </Select.Root>
                    <NumberField.Root
                      value={longSide}
                      min={200}
                      max={12000}
                      step={50}
                      onValueChange={(value) => {
                        if (value != null && value >= 200 && value <= 12000)
                          patch({ longSide: Math.round(value) })
                      }}
                    >
                      <NumberField.Group className="flex h-[26px]">
                        <NumberField.Decrement className="m-0 grid h-full w-6 cursor-pointer place-items-center rounded-none border border-r-0 border-line bg-panel-2 p-0 text-[13px] text-dim hover:bg-chip-hover hover:text-txt focus-visible:z-1 focus-visible:outline-1 focus-visible:outline-accent" aria-label="Decrease output size">
                          −
                        </NumberField.Decrement>
                        <NumberField.Input className="box-border m-0 w-[74px] rounded-none border border-line bg-panel-2 px-[7px] py-0 text-center text-xs text-txt tabular-nums focus-visible:z-1 focus-visible:outline-1 focus-visible:outline-accent" aria-label="Custom output size" />
                        <NumberField.Increment className="m-0 grid h-full w-6 cursor-pointer place-items-center rounded-none border border-l-0 border-line bg-panel-2 p-0 text-[13px] text-dim hover:bg-chip-hover hover:text-txt focus-visible:z-1 focus-visible:outline-1 focus-visible:outline-accent" aria-label="Increase output size">
                          +
                        </NumberField.Increment>
                      </NumberField.Group>
                    </NumberField.Root>
                    <span className="text-[11.5px] text-faint">px</span>
                    <span className="ml-0.5 text-xs text-accent tabular-nums">
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
