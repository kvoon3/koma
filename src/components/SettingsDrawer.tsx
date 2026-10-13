import { Drawer } from '@base-ui/react/drawer'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Switch } from '@base-ui/react/switch'
import { Tabs } from '@base-ui/react/tabs'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { Button, buttonBase, buttonVariants } from '@/components/ui/button'
import { colorInputCls, fieldControlCls, fieldLabelCls, fieldRowCls, RangeField } from '@/components/ui/field'
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
const swatchDot = 'h-2.5 w-2.5 bg-accent shadow-[0_0_0_2px_var(--drawerBg)]'

/**
 * The strip speaks the section-heading type, so the tabs read as the drawer's
 * group labels; the active one lights up and takes over the strip's bottom
 * rule (`-mb-px` lays its 1px border over the strip's). The heading classes
 * keep it on the same size, tracking and color system as every other heading.
 */
const tabCls = `${heading} -mb-px cursor-pointer border-b border-transparent bg-transparent px-0 pt-1.5 pb-2 transition-colors duration-(--dur-fast) hover:text-dim focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 data-active:border-accent data-active:text-txt`

/**
 * The panel scrolls, not the popup: the strip keeps its height, the popup its
 * max-height, and a short group stays at the top of its tab. It stays one grid
 * of rows (`section` inside), the same shape the drawer always used.
 */
const panel = 'grid min-h-0 flex-1 content-start gap-x-8 gap-y-3.5 overflow-x-hidden overflow-y-auto px-[18px] pt-3 pb-3 pointer-coarse:px-3.5 pointer-coarse:pb-4 max-sm:px-3.5 max-sm:pb-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-strip-thumb'

export function SettingsDrawer({ open, onClose }: { open: boolean, onClose: () => void }) {
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
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
      swipeDirection="down"
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-44 min-h-dvh bg-overlay-dim opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--dur-drawer) ease-(--ease-drawer) data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]" />
        <Drawer.Viewport className="fixed inset-0 z-45 flex items-end justify-center">
          <Drawer.Popup className="relative box-border flex max-h-[min(46vh,420px)] w-[min(560px,100vw)] flex-col overflow-hidden rounded-none border border-b-0 border-line bg-drawer-bg text-txt shadow-pop outline-0 translate-y-[var(--drawer-swipe-movement-y,0px)] transition-transform duration-(--dur-drawer) ease-(--ease-drawer) will-change-transform mb-[calc(var(--statusH)+env(safe-area-inset-bottom))] pointer-coarse:max-h-[62dvh] max-sm:max-h-[62dvh] data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:translate-y-[calc(100%+var(--statusH))] data-ending-style:translate-y-[calc(100%+var(--statusH))]">
            <Drawer.Content className="flex min-h-0 flex-1 flex-col outline-0">
              <header className="flex flex-none items-center gap-2.5 py-1.5 pl-3.5 pr-2.5">
                <Drawer.Title className="m-0 text-[12.5px] font-bold">{t('Settings')}</Drawer.Title>
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
                <Drawer.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Hide settings')}><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Drawer.Close>
              </header>

              {/*
                One tab per group of settings, so the drawer stops being a
                single long column. `activateOnFocus` lets the arrow keys swap
                the panel as they move through the strip; Tab walks in and out.
              */}
              <Tabs.Root
                className="flex min-h-0 flex-1 flex-col"
                value={tab}
                onValueChange={next => setTab(next)}
              >
                <Tabs.List
                  className="flex flex-none items-end gap-5 border-b border-line px-[18px] pointer-coarse:px-3.5 max-sm:px-3.5"
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
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
