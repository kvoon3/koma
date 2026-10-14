import { Popover } from '@base-ui/react/popover'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Switch } from '@base-ui/react/switch'
import { Tabs } from '@base-ui/react/tabs'
import { Settings } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { colorInputCls, fieldControlCls, fieldLabelCls, fieldRowCls, RangeField } from '@/components/ui/field'
import { Tip } from '@/components/ui/tip'
import { mirrorEnabled, setMirrorEnabled } from '../lib/fonts'
import { useT } from '../lib/i18n'
import { say } from '../lib/toast'
import { isTransparentBg, useStore } from '../store'

const CUSTOM_BG = '#18181b'

type BgMode = 'black' | 'white' | 'transparent' | 'custom'
type SettingsTab = 'appearance' | 'text'

/**
 * Every setting is a labelled control; the row template and the slider live in
 * `ui/field` so other surfaces (the sticker maker) share the same metrics.
 * The toggles below keep their own column placement in that template.
 */
const section = 'flex min-w-0 flex-col gap-[7px]'
const heading = 'm-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint'
const toggle = 'group/switch relative box-border col-start-2 row-start-1 inline-flex h-5 w-[34px] cursor-pointer items-center justify-self-end rounded-none border border-line-strong bg-line-strong p-0 transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] pointer-coarse:h-6 data-checked:border-accent data-checked:bg-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 sm:col-start-3'
const toggleThumb = 'block m-0.5 h-3.5 w-3.5 rounded-none border border-line-strong bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-(--dur-fast) group-data-checked/switch:translate-x-3.5'
const swatch = 'box-border grid h-[26px] w-[30px] cursor-pointer place-items-center rounded-none border border-line-strong transition-[border-color,scale] duration-(--dur-fast) active:scale-[0.97] p-0 data-checked:border-accent data-checked:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1'
const swatchDot = 'h-2.5 w-2.5 bg-accent shadow-[0_0_0_2px_var(--panel)]'

/**
 * The strip speaks the section-heading type, so the tabs read as the panel's
 * group labels; the active one lights up and takes over the strip's bottom
 * rule (`-mb-px` lays its 1px border over the strip's). The heading classes
 * keep it on the same size, tracking and color system as every other heading.
 */
const tabCls = `${heading} -mb-px cursor-pointer border-b border-transparent bg-transparent px-0 pt-1.5 pb-2 transition-colors duration-(--dur-fast) hover:text-dim focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 data-active:border-accent data-active:text-txt`

/**
 * The tab panel scrolls, not the dropdown: the strip keeps its height, the
 * popup its max-height, and a short group stays at the top of its tab. It is
 * still one grid of rows (`section` inside), the shape the drawer it replaced
 * used.
 */
const panel = 'grid min-h-0 flex-1 content-start gap-x-8 gap-y-3.5 overflow-x-hidden overflow-y-auto overscroll-contain px-3.5 pt-3 pb-3 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-strip-thumb'

/**
 * The settings dropdown, hung off the top bar's own Settings button: the
 * switch and the surface it opens are never more than a glance apart, where
 * the bottom drawer it replaced sat a screen away from its trigger. It wears
 * the chrome of the menus beside it (panel fill, `line-strong` border, the
 * same scale-out-from-the-trigger motion), being one more dropdown in the top
 * bar rather than a surface of its own. Sized to the field row, or below `sm`
 * to the viewport's width less the collision padding so the shift that keeps
 * it on screen leaves an even margin, and capped in height so it never grows
 * past the canvas it edits.
 */
const popup = 'flex max-h-[min(70dvh,520px)] w-[min(350px,calc(100vw-20px))] max-sm:w-[calc(100vw-12px)] flex-col overflow-hidden rounded-none border border-line-strong bg-panel text-txt shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-(--dur-surface) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]'

export function SettingsPanel({ open, onOpenChange, onTriggerEnter }: { open: boolean, onOpenChange: (open: boolean) => void, onTriggerEnter?: () => void }) {
  const gap = useStore(s => s.gap)
  const gridGap = useStore(s => s.gridGap)
  const radius = useStore(s => s.radius)
  const edgeFade = useStore(s => s.edgeFade)
  const edgeFadeStrength = useStore(s => s.edgeFadeStrength)
  const paneBorder = useStore(s => s.paneBorder)
  const bg = useStore(s => s.bg)
  const patch = useStore(s => s.patch)
  const resetSettings = useStore(s => s.resetSettings)
  const t = useT()
  const [mirror, setMirror] = useState(() => mirrorEnabled())
  const [tab, setTab] = useState<SettingsTab>('appearance')

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
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Tip
        label={t('Settings · Shortcut: ,')}
        trigger={(
          <Popover.Trigger
            // The pointer reaching this button takes the open panel from whichever
            // dropdown held it; `onTriggerEnter` is that hand-over.
            onMouseEnter={onTriggerEnter}
            render={(
              <Button variant={open ? 'on' : 'flat'} aria-label={t('Settings · Shortcut: ,')} data-bar-trigger="settings">
                <MorphIcon icon={Settings} size={15} strokeWidth={1.75} />
                <span className="pointer-coarse:hidden max-sm:hidden">{t('Settings')}</span>
              </Button>
            )}
          />
        )}
      />
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={6}
          className="z-[260] select-none outline-0"
        >
          <Popover.Popup className={popup}>
            <header className="flex flex-none items-center gap-2.5 py-1.5 pr-2.5 pl-3.5">
              <Popover.Title className="m-0 text-[12.5px] font-bold">{t('Settings')}</Popover.Title>
              <span className="flex-1" />
              <Button
                aria-label={t('Reset settings')}
                title={t('Reset settings')}
                onClick={() => {
                  resetSettings()
                  setMirror(true)
                  setMirrorEnabled(true)
                  say(t('Settings reset'))
                }}
              >
                {t('Reset')}
              </Button>
            </header>

            {/*
              One tab per group of settings, so the panel stops being a
              single long column. `activateOnFocus` lets the arrow keys swap
              the panel as they move through the strip; Tab walks in and out.
            */}
            <Tabs.Root
              className="flex min-h-0 flex-1 flex-col"
              value={tab}
              onValueChange={next => setTab(next)}
            >
              <Tabs.List
                className="flex flex-none items-end gap-5 border-b border-line px-3.5"
                aria-label={t('Settings sections')}
                activateOnFocus
              >
                <Tabs.Tab className={tabCls} value="appearance">{t('Appearance')}</Tabs.Tab>
                <Tabs.Tab className={tabCls} value="text">{t('Text')}</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel className={panel} value="appearance">
                <section className={section}>
                  <RangeField label={t('Photo gap')} text={`${(gap / 10).toFixed(1)}%`} max={120} value={gap} onChange={v => patch({ gap: v })} />
                  <div className={fieldRowCls}>
                    <span className={fieldLabelCls}>{t('Gap fill')}</span>
                    <RadioGroup
                      className={`${fieldControlCls} col-start-1 flex flex-wrap items-center gap-1.5`}
                      aria-label={t('Gap fill')}
                      value={mode}
                      onValueChange={next => setMode(next)}
                    >
                      <Radio.Root value="black" aria-label={t('Black')} className={`${swatch} bg-black`}>
                        <Radio.Indicator className={swatchDot} />
                      </Radio.Root>
                      <Radio.Root value="white" aria-label={t('White')} className={`${swatch} bg-white`}>
                        <Radio.Indicator className={swatchDot} />
                      </Radio.Root>
                      <Radio.Root value="transparent" aria-label={t('Transparent')} className={`${swatch} swatch-clear`}>
                        <Radio.Indicator className={swatchDot} />
                      </Radio.Root>
                      <input
                        type="color"
                        className={`${colorInputCls} w-9 ${mode === 'custom' ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]' : 'border-line-strong'}`}
                        aria-label={t('Custom gap fill')}
                        title={t('Pick a custom color')}
                        value={mode === 'custom' ? bg : CUSTOM_BG}
                        onChange={e => patch({ bg: e.target.value })}
                      />
                    </RadioGroup>
                  </div>
                  <RangeField label={t('Photo radius')} text={`${(radius / 10).toFixed(1)}%`} max={200} value={radius} onChange={v => patch({ radius: v })} />
                  <div className={fieldRowCls}>
                    <span className={fieldLabelCls}>{t('Pane border')}</span>
                    <Switch.Root
                      className={toggle}
                      aria-label={t('Pane border')}
                      checked={paneBorder}
                      onCheckedChange={checked => patch({ paneBorder: checked })}
                    >
                      <Switch.Thumb className={toggleThumb} />
                    </Switch.Root>
                  </div>
                  <RangeField label={t('Blend width')} text={`${(edgeFade / 10).toFixed(1)}%`} max={250} value={edgeFade} onChange={v => patch({ edgeFade: v })} />
                  <RangeField label={t('Blend strength')} text={`${edgeFadeStrength}%`} max={100} value={edgeFadeStrength} onChange={v => patch({ edgeFadeStrength: v })} />
                  <RangeField label={t('Grid gap')} text={`${gridGap}px`} max={40} value={gridGap} onChange={v => patch({ gridGap: v })} />
                </section>
              </Tabs.Panel>

              <Tabs.Panel className={panel} value="text">
                <section className={section}>
                  <div className={fieldRowCls}>
                    <span className={fieldLabelCls}>{t('Font mirror')}</span>
                    <Switch.Root
                      className={toggle}
                      aria-label={t('Font mirror')}
                      checked={mirror}
                      onCheckedChange={(checked) => {
                        setMirror(checked)
                        setMirrorEnabled(checked)
                      }}
                    >
                      <Switch.Thumb className={toggleThumb} />
                    </Switch.Root>
                  </div>
                </section>
              </Tabs.Panel>
            </Tabs.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
