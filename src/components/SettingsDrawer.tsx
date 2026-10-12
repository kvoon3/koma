import { Drawer } from '@base-ui/react/drawer'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Slider } from '@base-ui/react/slider'
import { Switch } from '@base-ui/react/switch'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { Button, buttonBase, buttonVariants } from '@/components/ui/button'
import { mirrorEnabled, setMirrorEnabled } from '../lib/fonts'
import { setLang, useLang, useT } from '../lib/i18n'
import { isTransparentBg, useStore } from '../store'

const CUSTOM_BG = '#18181b'

type BgMode = 'black' | 'white' | 'transparent' | 'custom'

/**
 * One row shape for every setting: label / control / value. From `sm` up a fixed
 * label column keeps all controls on the same x, so the sliders line up (the old
 * `flex-wrap` rows let a long label wrap and shove its control down out of
 * line). Narrower than that the two fixed columns would eat 158 of the ~350px a
 * phone has, leaving a stub of a slider: there the value moves up onto the label
 * line and the control takes the whole width below it.
 */
const row = 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 sm:grid-cols-[84px_minmax(0,1fr)_46px]'
const label = 'col-start-1 row-start-1 whitespace-nowrap text-xs text-dim'
const control = 'col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1'
const section = 'flex min-w-0 flex-col gap-[7px]'
const heading = 'm-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint'
const value = 'col-start-2 row-start-1 justify-self-end text-right text-xs text-accent tabular-nums sm:col-start-3'
const toggle = 'group/switch relative box-border col-start-2 row-start-1 inline-flex h-5 w-[34px] cursor-pointer items-center justify-self-end rounded-none border border-line-strong bg-line-strong p-0 transition-colors duration-[120ms] pointer-coarse:h-6 data-checked:border-accent data-checked:bg-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 sm:col-start-3'
const toggleThumb = 'block m-0.5 h-3.5 w-3.5 rounded-none border border-line-strong bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-[120ms] group-data-checked/switch:translate-x-3.5'
const swatch = 'box-border grid h-[26px] w-[30px] cursor-pointer place-items-center rounded-none border border-line-strong p-0 data-checked:border-accent data-checked:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1'
const swatchDot = 'h-2.5 w-2.5 bg-accent shadow-[0_0_0_2px_var(--drawerBg)]'
const sliderThumb = 'box-border h-3 w-3 select-none rounded-none border border-accent bg-panel has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2'

function SliderRow({ name, text, max, cur, onChange }: { name: string, text: string, max: number, cur: number, onChange: (v: number) => void }) {
  return (
    <div className={row}>
      <span className={label}>{name}</span>
      {/* Half a thumb of inline padding, so a full-width narrow track keeps its
          handle inside the row at 0% and 100% instead of poking past the text. */}
      <Slider.Root className={control} min={0} max={max} value={cur} onValueChange={onChange}>
        <Slider.Control className="flex touch-none select-none items-center px-1.5 py-2 sm:px-0">
          <Slider.Track className="relative h-1.5 w-full bg-panel-2 shadow-[inset_0_0_0_1px_var(--line)] select-none">
            <Slider.Indicator className="bg-accent" />
            <Slider.Thumb className={sliderThumb} aria-label={name} />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span className={value}>{text}</span>
    </div>
  )
}

export function SettingsDrawer({ open, onClose }: { open: boolean, onClose: () => void }) {
  const gap = useStore(s => s.gap)
  const radius = useStore(s => s.radius)
  const edgeFade = useStore(s => s.edgeFade)
  const edgeFadeStrength = useStore(s => s.edgeFadeStrength)
  const paneBorder = useStore(s => s.paneBorder)
  const bg = useStore(s => s.bg)
  const patch = useStore(s => s.patch)
  const t = useT()
  const lang = useLang()
  const [mirror, setMirror] = useState(() => mirrorEnabled())

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
        <Drawer.Backdrop className="fixed inset-0 z-44 min-h-dvh bg-overlay-dim opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-[450ms] ease-(--ease-drawer) data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]" />
        <Drawer.Viewport className="fixed inset-0 z-45 flex items-end justify-center">
          <Drawer.Popup className="relative box-border flex max-h-[min(46vh,420px)] w-[min(920px,100vw)] flex-col overflow-hidden rounded-none border border-b-0 border-line bg-drawer-bg text-txt shadow-pop outline-0 translate-y-[var(--drawer-swipe-movement-y,0px)] transition-transform duration-[450ms] ease-(--ease-drawer) will-change-transform mb-[calc(var(--statusH)+env(safe-area-inset-bottom))] pointer-coarse:max-h-[62dvh] max-sm:max-h-[62dvh] data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:translate-y-[calc(100%+var(--statusH))] data-ending-style:translate-y-[calc(100%+var(--statusH))]">
            <Drawer.Content className="flex min-h-0 flex-1 flex-col outline-0">
              <header className="flex flex-none items-center gap-2.5 py-1.5 pl-3.5 pr-2.5">
                <Drawer.Title className="m-0 text-[12.5px] font-bold">{t('Settings')}</Drawer.Title>
                <span className="flex-1" />
                <Drawer.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Hide settings')}><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Drawer.Close>
              </header>

              {/*
                Vertical scrolling only: sections stack on narrow screens and
                pair up on wide ones. `Layout` is the tall one (four sliders and
                a switch), so it pins the right column and spans the three rows
                the shorter three stack in; every row therefore ends up level.
              */}
              <div className="grid min-h-0 flex-1 gap-x-8 gap-y-3.5 overflow-x-hidden overflow-y-auto px-[18px] pt-1 pb-3 pointer-coarse:px-3.5 pointer-coarse:pt-3 pointer-coarse:pb-4 max-sm:px-3.5 max-sm:pt-3 max-sm:pb-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-strip-thumb md:grid-cols-2">
                <section className={section}>
                  <h4 className={heading}>{t('Appearance')}</h4>
                  <div className={row}>
                    <span className={label}>{t('Gap fill')}</span>
                    <RadioGroup
                      className="col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-1.5 sm:col-start-2 sm:row-start-1"
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
                        className={`box-border h-[26px] w-9 cursor-pointer rounded-none border bg-panel-2 p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 ${mode === 'custom' ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]' : 'border-line-strong'}`}
                        aria-label={t('Custom gap fill')}
                        title={t('Pick a custom color')}
                        value={mode === 'custom' ? bg : CUSTOM_BG}
                        onChange={e => patch({ bg: e.target.value })}
                      />
                    </RadioGroup>
                  </div>
                </section>

                <section className={`${section} md:col-start-2 md:row-span-3`}>
                  <h4 className={heading}>{t('Layout')}</h4>
                  <SliderRow name={t('Photo gap')} text={`${(gap / 10).toFixed(1)}%`} max={120} cur={gap} onChange={v => patch({ gap: v })} />
                  <SliderRow name={t('Photo radius')} text={`${(radius / 10).toFixed(1)}%`} max={200} cur={radius} onChange={v => patch({ radius: v })} />
                  <SliderRow name={t('Blend width')} text={`${(edgeFade / 10).toFixed(1)}%`} max={250} cur={edgeFade} onChange={v => patch({ edgeFade: v })} />
                  <SliderRow name={t('Blend strength')} text={`${edgeFadeStrength}%`} max={100} cur={edgeFadeStrength} onChange={v => patch({ edgeFadeStrength: v })} />
                  <div className={row}>
                    <span className={label}>{t('Pane border')}</span>
                    <Switch.Root
                      className={toggle}
                      aria-label={t('Pane border')}
                      checked={paneBorder}
                      onCheckedChange={checked => patch({ paneBorder: checked })}
                    >
                      <Switch.Thumb className={toggleThumb} />
                    </Switch.Root>
                  </div>
                </section>

                <section className={section}>
                  <h4 className={heading}>{t('Fonts')}</h4>
                  <div className={row}>
                    <span className={label}>{t('Font mirror')}</span>
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

                <section className={section}>
                  <h4 className={heading}>{t('Language')}</h4>
                  {/* No label column: the buttons sit under the heading, left-aligned with it. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      variant={lang === 'en' ? 'on' : 'flat'}
                      aria-pressed={lang === 'en'}
                      onClick={() => setLang('en')}
                    >
                      English
                    </Button>
                    <Button
                      variant={lang === 'zh' ? 'on' : 'flat'}
                      aria-pressed={lang === 'zh'}
                      onClick={() => setLang('zh')}
                    >
                      简体中文
                    </Button>
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
