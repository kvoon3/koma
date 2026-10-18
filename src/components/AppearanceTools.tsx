import type { Photo } from '../lib/imageStore'
import { Popover } from '@base-ui/react/popover'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Switch } from '@base-ui/react/switch'
import { Frame, Grid3x3, ImagePlus } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo, useRef, useState } from 'react'
import { colorInputCls, fieldControlCls, fieldLabelCls, fieldRowCls, RangeField, SegmentedField } from '@/components/ui/field'
import { useThumb } from '../hooks'
import { useT } from '../lib/i18n'
import { photoAssetsOf } from '../lib/stickerLibrary'
import { say } from '../lib/toast'
import { isTransparentBg, useStore } from '../store'
import { toolsBtnCls, toolsLabelCls } from './ToolsDock'
import { dockBtnStateCls, dockPopupMotionCls, menuSurfaceCls } from './ui/menu'

const CUSTOM_BG = '#18181b'

/** Opposite end for a fresh gradient: dark fills fade to white, light to black. */
const gradientEnd = (bg: string) => (bg === '#ffffff' ? '#000000' : '#ffffff')

const toggle = 'group/switch relative box-border col-start-2 row-start-1 inline-flex h-5 w-[34px] cursor-pointer items-center justify-self-end rounded-none border border-line-strong bg-line-strong p-0 transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] pointer-coarse:h-6 data-checked:border-accent data-checked:bg-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 sm:col-start-3'
const toggleThumb = 'block m-0.5 h-3.5 w-3.5 rounded-none border border-line-strong bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-(--dur-fast) group-data-checked/switch:translate-x-3.5'
const swatch = 'box-border grid h-[26px] w-[30px] cursor-pointer place-items-center rounded-none border border-line-strong transition-[border-color,scale] duration-(--dur-fast) active:scale-[0.97] p-0 data-checked:border-accent data-checked:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1'
const swatchDot = 'h-2.5 w-2.5 bg-accent shadow-[0_0_0_2px_var(--panel)]'
const popup = `${menuSurfaceCls} ${dockPopupMotionCls} w-[min(320px,calc(100vw-24px))] max-h-[min(70dvh,480px)] overflow-y-auto overscroll-contain p-3.5`
const fields = 'flex min-w-0 flex-col gap-[7px]'
const heading = 'm-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint'

/** One library photo as a background choice. */
function BgPhotoSwatch({ photo, label }: { photo: Photo, label: string }) {
  const url = useThumb(photo, true)
  return (
    <Radio.Root value={photo.id} aria-label={label} title={photo.name} className={`${swatch} shrink-0 overflow-hidden bg-panel-2`}>
      {url && <img src={url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />}
      <Radio.Indicator className={`${swatchDot} absolute`} />
    </Radio.Root>
  )
}

type BgMode = 'black' | 'white' | 'transparent' | 'custom'
type BgKind = 'solid' | 'gradient' | 'image'

/**
 * The one canvas-appearance Tools entry on the collage stage: Border.
 * Opens a panel with gap, fill, radius, pane border, crossfade, blend, reset.
 * Grid gap is enabled on the grid route only (see GridDockTool).
 */
export function AppearanceDockTools() {
  const [open, setOpen] = useState(false)
  const gap = useStore(s => s.gap)
  const radius = useStore(s => s.radius)
  const edgeFade = useStore(s => s.edgeFade)
  const edgeFadeStrength = useStore(s => s.edgeFadeStrength)
  const blendCrossfade = useStore(s => s.blendCrossfade)
  const paneBorder = useStore(s => s.paneBorder)
  const bg = useStore(s => s.bg)
  const bgGradient = useStore(s => s.bgGradient)
  const bgImage = useStore(s => s.bgImage)
  const allPhotos = useStore(s => s.photos)
  // A sticker as the collage background is not a thing; the swatches list photos.
  const photos = useMemo(() => photoAssetsOf(allPhotos), [allPhotos])
  const patch = useStore(s => s.patch)
  const resetSettings = useStore(s => s.resetSettings)
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const storedKind: BgKind = bgImage ? 'image' : bgGradient && !isTransparentBg(bg) ? 'gradient' : 'solid'
  const [pendingImage, setPendingImage] = useState(false)
  const kind: BgKind = pendingImage && storedKind === 'solid' ? 'image' : storedKind

  const setKind = (next: BgKind) => {
    setPendingImage(next === 'image')
    if (next === 'solid')
      patch({ bgGradient: null, bgImage: null })
    else if (next === 'gradient')
      patch({ bg: isTransparentBg(bg) ? '#000000' : bg, bgGradient: bgGradient ?? gradientEnd(bg), bgImage: null })
    else
      patch({ bgGradient: null })
  }

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
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`${toolsBtnCls} ${dockBtnStateCls}`}
        title={t('Border')}
        aria-label={t('Border')}
        data-dock-tool={t('Border')}
      >
        <MorphIcon icon={Frame} size={22} strokeWidth={1.5} />
        <span className={toolsLabelCls}>{t('Border')}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={6} collisionPadding={6} className="z-[260] select-none outline-0">
          <Popover.Popup className={popup}>
            <div className="mb-2.5 flex items-center gap-2">
              <p className={heading}>{t('Border')}</p>
              <span className="flex-1" />
              <button
                type="button"
                className="cursor-pointer rounded-none border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-semibold text-dim transition-colors hover:text-txt"
                onClick={() => {
                  resetSettings()
                  say(t('Settings reset'))
                }}
              >
                {t('Reset')}
              </button>
            </div>
            <section className={fields}>
              <RangeField label={t('Photo gap')} text={`${(gap / 10).toFixed(1)}%`} max={120} value={gap} onChange={v => patch({ gap: v })} />
              <SegmentedField
                label={t('Background')}
                value={kind}
                items={[{ value: 'solid', label: t('Solid color') }, { value: 'gradient', label: t('Gradient') }, { value: 'image', label: t('Image') }]}
                onChange={setKind}
              />
              {kind !== 'image' && (
                <div className={fieldRowCls}>
                  <span className={fieldLabelCls}>{kind === 'gradient' ? t('Gradient start color') : t('Color')}</span>
                  <RadioGroup
                    className={`${fieldControlCls} col-start-1 flex flex-wrap items-center gap-1.5`}
                    aria-label={t('Background')}
                    value={mode}
                    onValueChange={next => setMode(next)}
                  >
                    <Radio.Root value="black" aria-label={t('Black')} className={`${swatch} bg-black`}>
                      <Radio.Indicator className={swatchDot} />
                    </Radio.Root>
                    <Radio.Root value="white" aria-label={t('White')} className={`${swatch} bg-white`}>
                      <Radio.Indicator className={swatchDot} />
                    </Radio.Root>
                    {kind === 'solid' && (
                      <Radio.Root value="transparent" aria-label={t('Transparent')} className={`${swatch} swatch-clear`}>
                        <Radio.Indicator className={swatchDot} />
                      </Radio.Root>
                    )}
                    <input
                      type="color"
                      className={`${colorInputCls} w-9 ${mode === 'custom' ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]' : 'border-line-strong'}`}
                      aria-label={t('Custom background color')}
                      title={t('Pick a custom color')}
                      value={mode === 'custom' ? bg : CUSTOM_BG}
                      onChange={e => patch({ bg: e.target.value })}
                    />
                  </RadioGroup>
                </div>
              )}
              {kind === 'gradient' && bgGradient && (
                <div className={fieldRowCls}>
                  <span className={fieldLabelCls}>{t('Gradient end color')}</span>
                  <div className={`${fieldControlCls} col-start-1 flex items-center gap-1.5`}>
                    <input
                      type="color"
                      className={`${colorInputCls} w-9 border-line-strong`}
                      aria-label={t('Gradient end color')}
                      title={t('Gradient end color')}
                      value={bgGradient}
                      onChange={e => patch({ bgGradient: e.target.value })}
                    />
                  </div>
                </div>
              )}
              {kind === 'image' && (
                <div className={fieldRowCls}>
                  <span className={fieldLabelCls}>{t('Image')}</span>
                  <RadioGroup
                    className={`${fieldControlCls} col-span-2 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:col-span-2`}
                    aria-label={t('Background photo')}
                    value={bgImage?.photoId ?? ''}
                    onValueChange={id => patch({ bgImage: id ? { photoId: id as string, blur: bgImage?.blur ?? true } : null })}
                  >
                    <button
                      type="button"
                      aria-label={t('Upload background photo')}
                      title={t('Upload background photo')}
                      className={`${swatch} shrink-0 bg-panel-2 text-dim`}
                      onClick={() => fileRef.current?.click()}
                    >
                      <MorphIcon icon={ImagePlus} size={14} strokeWidth={1.75} />
                    </button>
                    <Radio.Root value="" aria-label={t('No background photo')} title={t('No background photo')} className={`${swatch} shrink-0 swatch-clear`}>
                      <Radio.Indicator className={swatchDot} />
                    </Radio.Root>
                    {photos.map(p => <BgPhotoSwatch key={p.id} photo={p} label={t('Background photo')} />)}
                  </RadioGroup>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file)
                        return
                      const added = useStore.getState().addPhotos([file], false)[0]
                      if (added)
                        patch({ bgImage: { photoId: added.id, blur: bgImage?.blur ?? true } })
                    }}
                  />
                </div>
              )}
              {kind === 'image' && bgImage && (
                <div className={fieldRowCls}>
                  <span className={fieldLabelCls}>{t('Blur photo')}</span>
                  <Switch.Root
                    className={toggle}
                    aria-label={t('Blur photo')}
                    checked={bgImage.blur}
                    onCheckedChange={checked => patch({ bgImage: { ...bgImage, blur: checked } })}
                  >
                    <Switch.Thumb className={toggleThumb} />
                  </Switch.Root>
                </div>
              )}
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
              <div className={fieldRowCls}>
                <span className={fieldLabelCls}>{t('Photo crossfade')}</span>
                <Switch.Root
                  className={toggle}
                  aria-label={t('Photo crossfade')}
                  checked={blendCrossfade}
                  onCheckedChange={checked => patch({ blendCrossfade: checked })}
                >
                  <Switch.Thumb className={toggleThumb} />
                </Switch.Root>
              </div>
              <RangeField label={t('Blend width')} text={`${(edgeFade / 10).toFixed(1)}%`} max={250} value={edgeFade} onChange={v => patch({ edgeFade: v })} />
              <RangeField label={t('Blend strength')} text={`${edgeFadeStrength}%`} max={100} value={edgeFadeStrength} onChange={v => patch({ edgeFadeStrength: v })} />
            </section>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * Grid gap for the 3×3 workspace overview. Mounted on every route (stable
 * dock layout) and disabled off the grid via `requires: 'grid'`.
 */
export function GridDockTool({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const gridGap = useStore(s => s.gridGap)
  const patch = useStore(s => s.patch)
  const t = useT()

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className={`${toolsBtnCls} ${dockBtnStateCls} disabled:cursor-default disabled:opacity-35 disabled:active:scale-100 disabled:hover:bg-transparent`}
        title={t('Grid')}
        aria-label={t('Grid')}
        data-dock-tool={t('Grid')}
      >
        <MorphIcon icon={Grid3x3} size={22} strokeWidth={1.5} />
        <span className={toolsLabelCls}>{t('Grid')}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={6} collisionPadding={6} className="z-[260] select-none outline-0">
          <Popover.Popup className={`${menuSurfaceCls} ${dockPopupMotionCls} w-[min(280px,calc(100vw-24px))] p-3`}>
            <RangeField label={t('Grid gap')} text={`${gridGap}px`} max={40} value={gridGap} onChange={v => patch({ gridGap: v })} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
