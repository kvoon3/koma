import { Select } from '@base-ui/react/select'
import { Slider } from '@base-ui/react/slider'
import { Check, ChevronDown } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { menuItemCls } from './menu'

/**
 * The app's one labelled-control row: label / control / value on a single
 * grid. From `sm` up the fixed label column puts every control on the same x;
 * below it the value moves onto the label line and the control takes the full
 * width beneath it. The settings drawer and the sticker maker share it, so a
 * new surface picks up the same metrics instead of re-tuning them.
 */
export const fieldRowCls = 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 sm:grid-cols-[84px_minmax(0,1fr)_46px]'
export const fieldLabelCls = 'col-start-1 row-start-1 whitespace-nowrap text-xs text-dim'
export const fieldControlCls = 'col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1'
export const fieldValueCls = 'col-start-2 row-start-1 justify-self-end text-right text-xs text-accent tabular-nums sm:col-start-3'

/**
 * Color inputs carry `line-strong`: `line` equals the panel's own color in the
 * dark theme and would leave the control a featureless patch. Width and the
 * active border stay with the caller (a full-width field or a small swatch).
 */
export const colorInputCls = 'box-border h-[26px] cursor-pointer rounded-none border bg-panel-2 p-0 focus-visible:border-accent focus-visible:outline-1 focus-visible:outline-accent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0'

/** The drawer's square slider thumb: accent hairline, panel fill. */
const sliderThumbCls = 'box-border h-3 w-3 select-none rounded-none border border-accent bg-panel has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2'

/**
 * The shared Base UI slider chrome (track + square thumb). Settings and the
 * sticker maker wrap it in `RangeField`; compact surfaces (the label toolbar)
 * mount it alone so they never fall back to a native `<input type=range>`.
 */
export function AppSlider({ value, min = 0, max, step, label, onChange, className = '', dense = false }: {
  value: number
  min?: number
  max: number
  step?: number
  label: string
  onChange: (value: number) => void
  className?: string
  /** Tighter padding for icon toolbars (the floating label chrome). */
  dense?: boolean
}) {
  return (
    <Slider.Root
      className={dense ? 'box-border h-full w-full' : className}
      min={min}
      max={max}
      step={step}
      value={value}
      onValueChange={v => onChange(v as number)}
    >
      <Slider.Control className={`flex h-full touch-none select-none items-center ${dense ? 'px-1' : 'px-1.5 py-2 sm:px-0'}`}>
        <Slider.Track className="relative h-1.5 w-full bg-panel-2 shadow-[inset_0_0_0_1px_var(--line)] select-none">
          <Slider.Indicator className="bg-accent" />
          <Slider.Thumb className={sliderThumbCls} aria-label={label} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  )
}

/** A labelled range slider whose live value sits in the row's value column. */
export function RangeField({ label, text, value, min = 0, max, step, onChange }: {
  label: string
  text: string
  value: number
  min?: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <div className={fieldRowCls}>
      <span className={fieldLabelCls}>{label}</span>
      {/* Half a thumb of inline padding, so a full-width narrow track keeps its
          handle inside the row at 0% and 100% instead of poking past the text. */}
      <AppSlider
        className={fieldControlCls}
        min={min}
        max={max}
        step={step}
        value={value}
        label={label}
        onChange={onChange}
      />
      <span className={fieldValueCls}>{text}</span>
    </div>
  )
}

/** A labelled color swatch sized like the other form controls. */
export function ColorField({ label, value, onChange }: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className={fieldRowCls}>
      <span className={fieldLabelCls}>{label}</span>
      <input
        type="color"
        className={`${fieldControlCls} ${colorInputCls} w-full border-line-strong`}
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}

const selectTriggerCls = 'box-border inline-flex h-[26px] w-full cursor-pointer items-center justify-between gap-1.5 overflow-hidden rounded-none border border-line-strong bg-panel-2 px-2 text-xs whitespace-nowrap text-txt hover:bg-chip-hover focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1'

/**
 * A labelled dropdown. The popup reuses the menu row chrome, so a select opens
 * the same surface as the top bar's menus instead of a browser list.
 */
export function SelectField({ label, value, items, onChange }: {
  label: string
  value: string
  items: { value: string, label: string, fontFamily?: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className={fieldRowCls}>
      <span className={fieldLabelCls}>{label}</span>
      <Select.Root items={items} value={value} onValueChange={v => onChange(v as string)}>
        <Select.Trigger className={`${fieldControlCls} ${selectTriggerCls}`} aria-label={label}>
          <Select.Value />
          <Select.Icon className="flex flex-none text-dim">
            <MorphIcon icon={ChevronDown} size={12} strokeWidth={1.75} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="z-[260] select-none outline-0" sideOffset={4} align="start" alignItemWithTrigger={false}>
            <Select.Popup className="min-w-[var(--anchor-width)] rounded-none border border-line-strong bg-panel p-1 shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-(--dur-surface) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]">
              <Select.List className="relative max-h-[var(--available-height)] overflow-y-auto">
                {items.map(item => (
                  <Select.Item key={item.value} value={item.value} className={menuItemCls}>
                    <Select.ItemText className="flex-1" style={item.fontFamily ? { fontFamily: item.fontFamily } : undefined}>{item.label}</Select.ItemText>
                    <Select.ItemIndicator className="ml-auto flex pl-2 text-accent">
                      <MorphIcon icon={Check} size={12} strokeWidth={2} />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}
