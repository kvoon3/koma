import type { StickerMaterialType, StickerSource } from '../lib/sticker'
import { Dialog } from '@base-ui/react/dialog'
import { ImagePlus, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { buttonBase, buttonVariants } from '@/components/ui/buttonStyles'
import { ColorField, RangeField, SelectField } from '@/components/ui/field'
import { Tip } from '@/components/ui/tip'
import { removeBackground } from '../lib/bgRemoval'
import { pickImageFiles } from '../lib/filePicker'
import { useT } from '../lib/i18n'
import { makeSticker } from '../lib/sticker'
import { STICKER_ICONS } from '../lib/stickerIcons'
import { say } from '../lib/toast'
import { dataUrlToFile } from '../lib/workspaceFile'
import { useStore } from '../store'

/**
 * Text font choices: a small set of system stacks (no webfont download, so the
 * preview matches the export instantly). The rounded one is the "sticker" pick.
 */
const FONTS = [
  {
    id: 'system',
    label: 'System',
    stack: '-apple-system, BlinkMacSystemFont, \'Segoe UI\', \'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', \'Noto Sans SC\', sans-serif',
    weight: 700,
  },
  {
    id: 'rounded',
    label: 'Rounded bold',
    stack: '\'Arial Rounded MT Bold\', \'Nunito\', ui-rounded, \'Hiragino Maru Gothic ProN\', \'PingFang SC\', \'Microsoft YaHei\', sans-serif',
    weight: 800,
  },
  {
    id: 'serif',
    label: 'Serif',
    stack: 'Georgia, \'Songti SC\', \'Noto Serif SC\', \'Times New Roman\', serif',
    weight: 700,
  },
  {
    id: 'mono',
    label: 'Mono',
    stack: 'ui-monospace, \'SF Mono\', Menlo, Consolas, \'Courier New\', monospace',
    weight: 700,
  },
]

const MATERIALS: { value: StickerMaterialType, label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'holographic', label: 'Holographic' },
  { value: 'glitter', label: 'Glitter' },
]

const OUTLINE_DEFAULT = 18
/** Classic preset: black lettering on a white fill, white die-cut border. */
const TEXT_COLOR_DEFAULT = '#000000'
const BACKGROUND_DEFAULT = '#ffffff'
const OUTLINE_COLOR_DEFAULT = '#ffffff'
const PREVIEW_MAX = 480
const INSERT_MAX = 960

/** Curated text-color swatches; ColorField still covers any custom hex. */
const TEXT_COLOR_SWATCHES = [
  '#000000',
  '#ffffff',
  '#ff2d55',
  '#ff9500',
  '#34c759',
  '#007aff',
  '#5856d6',
  '#af52de',
]

/** Background swatches. First entry is transparent (glyph-only die-cut). */
const BACKGROUND_SWATCHES: (string | null)[] = [
  null,
  '#ffffff',
  '#111111',
  '#ff2d55',
  '#ff9500',
  '#ffe566',
  '#34c759',
  '#0a7ea4',
  '#f5e6ff',
]

interface TextStylePreset {
  id: string
  label: string
  color: string
  background: string | null
  outlineColor: string
}

/** Named bundles that set fill + text (+ outline when it reads as one look). */
const STYLE_PRESETS: TextStylePreset[] = [
  { id: 'classic', label: 'Classic', color: '#000000', background: '#ffffff', outlineColor: '#ffffff' },
  { id: 'inverted', label: 'Inverted', color: '#ffffff', background: '#111111', outlineColor: '#111111' },
  { id: 'pop', label: 'Pop', color: '#ffffff', background: '#ff2d55', outlineColor: '#ffffff' },
  { id: 'pastel', label: 'Pastel', color: '#5b4a6a', background: '#f5e6ff', outlineColor: '#ffffff' },
  { id: 'ocean', label: 'Ocean', color: '#ffffff', background: '#0a7ea4', outlineColor: '#ffffff' },
  { id: 'sunshine', label: 'Sunshine', color: '#1a1a1a', background: '#ffe566', outlineColor: '#ffffff' },
]

const swatchBtnCls = 'box-border h-[26px] w-[30px] shrink-0 cursor-pointer rounded-none border border-line-strong p-0 transition-[border-color,scale] duration-(--dur-fast) active:scale-[0.97] focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1'
const swatchActiveCls = 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]'

const stageFrameCls = 'stage-clear relative flex h-[220px] items-center justify-center overflow-hidden border border-line-strong'

function buildSource(
  tab: 'text' | 'image',
  text: string,
  color: string,
  background: string | null,
  fontMeta: (typeof FONTS)[number],
  iconId: string | null,
  imageSrc: string | null,
  imageName: string,
): StickerSource | null {
  if (tab === 'text') {
    const value = text.trim()
    return value
      ? { type: 'text', text: value, color, background, fontFamily: fontMeta.stack, fontWeight: fontMeta.weight, iconId }
      : null
  }
  return imageSrc ? { type: 'image', src: imageSrc, name: imageName } : null
}

function sameHex(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

function presetMatches(preset: TextStylePreset, color: string, background: string | null, outlineColor: string) {
  const bgOk = preset.background === null
    ? background === null
    : background !== null && sameHex(preset.background, background)
  return sameHex(preset.color, color) && bgOk && sameHex(preset.outlineColor, outlineColor)
}

/** Local U²-Netᵖ cutout; reports progress and hands back a PNG object URL. */
async function cutoutBackground(
  imageSrc: string,
  onJob: (job: { phase: 'loading' | 'processing', progress?: number } | null) => void,
  onDone: (url: string) => void,
  onFail: (reason: string) => void,
) {
  onJob({ phase: 'loading', progress: 0 })
  try {
    const res = await fetch(imageSrc)
    // A revoked or cross-origin blob: URL makes `fetch` reject rather than
    // answer non-2xx, so this guard never fires for today's inputs. It stays
    // as the required response check and a net for any future non-blob source.
    if (!res.ok)
      throw new Error(`Could not read the picked image (HTTP ${res.status})`)
    const blob = await res.blob()
    const cutout = await removeBackground(blob, p => onJob(p))
    onDone(URL.createObjectURL(cutout))
  }
  catch (error) {
    // The worker reports why it gave up (missing model file, no OffscreenCanvas,
    // out of memory). Keep it for the dev console and put it in the toast: a
    // phone has no console to look at.
    console.error('[bgRemoval]', error)
    onFail(error instanceof Error ? error.message : String(error))
  }
  finally {
    onJob(null)
  }
}

/** Rasterize the sticker, add it to the library, and pin it onto the pane. */
async function insertSticker(
  source: StickerSource | null,
  paneId: string | null,
  style: { outlineWidth: number, outlineColor: string, material: StickerMaterialType, baseName: string },
  t: (key: string) => string,
  onDone: () => void,
) {
  if (!source || !paneId)
    return
  const res = await makeSticker(source, {
    outlineWidth: style.outlineWidth,
    outlineColor: style.outlineColor,
    maxEdge: INSERT_MAX,
    material: { type: style.material, intensity: 1 },
  })
  const file = await dataUrlToFile(res.dataUrl, `${style.baseName || 'sticker'}.png`)
  const s = useStore.getState()
  const photo = s.addPhotos([file], false)[0]
  if (photo) {
    s.addSticker(paneId, photo.id, 0.5, 0.5)
    say(t('Sticker added'))
  }
  onDone()
}

/** Debounced live preview of the sticker the current inputs would produce. */
function StickerPreview({ source, outlineWidth, outlineColor, material }: {
  source: StickerSource | null
  outlineWidth: number
  outlineColor: string
  material: StickerMaterialType
}) {
  const t = useT()
  const [rendered, setRendered] = useState<{ key: string, url: string } | null>(null)
  const renderKey = useMemo(
    () => (source ? JSON.stringify([source, outlineWidth, outlineColor, material]) : ''),
    [source, outlineWidth, outlineColor, material],
  )

  // Live preview, debounced so typing / dragging a slider doesn't flood makeSticker.
  useEffect(() => {
    if (!source)
      return
    let alive = true
    const id = window.setTimeout(() => {
      makeSticker(source, { outlineWidth, outlineColor, maxEdge: PREVIEW_MAX, material: { type: material, intensity: 1 } })
        .then((res) => {
          if (alive)
            setRendered({ key: renderKey, url: res.dataUrl })
        })
        .catch(() => {
          if (alive)
            setRendered({ key: renderKey, url: '' })
        })
    }, 150)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [source, outlineWidth, outlineColor, material, renderKey])

  const url = source && rendered?.key === renderKey ? rendered.url || null : null
  const rendering = !!source && rendered?.key !== renderKey
  if (url) {
    return <img src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
  }
  return (
    <span className="text-[11.5px] text-faint">
      {rendering ? t('Rendering…') : t('Nothing to preview')}
    </span>
  )
}

/** One background-removal job's progress report for the UI. */
interface BgJob {
  phase: 'loading' | 'processing'
  progress?: number
}

/** Frosted cutout progress over the raw pick while the local model runs. */
function CutoutOverlay({ job }: { job: BgJob }) {
  const t = useT()
  const loading = job.phase === 'loading'
  const pct = Math.round(job.progress ?? 0)
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-panel/75 backdrop-blur-[6px]">
      <span className="text-[12.5px] font-semibold text-txt">
        {loading ? t('Loading AI model…') : t('Cutting out…')}
      </span>
      <div className="h-1.5 w-40 overflow-hidden border border-line bg-panel">
        <div
          className={`h-full bg-accent transition-[width] duration-(--dur-fast) ${loading ? '' : ' w-2/3 animate-pulse'}`}
          style={loading ? { width: `${pct}%` } : undefined}
        />
      </div>
      {loading && (
        <span className="text-[11px] tabular-nums text-faint">
          {pct}
          %
        </span>
      )}
    </div>
  )
}

/** Image-tab stage shape derived from the pick and the cutout job. */
type ImageStage = 'empty' | 'cuttingOut' | 'ready'

function imageStageOf(imageSrc: string | null, bgJob: BgJob | null): ImageStage {
  if (!imageSrc)
    return 'empty'
  if (bgJob)
    return 'cuttingOut'
  return 'ready'
}

/**
 * Shared stage for both tabs: empty image pick target, cutout overlay on the
 * raw pick, or the live makeSticker preview (with image action chips).
 */
function StickerStage({
  tab,
  imageStage,
  imageSrc,
  bgJob,
  hasCutout,
  source,
  outlineWidth,
  outlineColor,
  material,
  onPick,
  onRemoveBg,
  onRestore,
}: {
  tab: 'text' | 'image'
  imageStage: ImageStage
  imageSrc: string | null
  bgJob: BgJob | null
  hasCutout: boolean
  source: StickerSource | null
  outlineWidth: number
  outlineColor: string
  material: StickerMaterialType
  onPick: () => void
  onRemoveBg: () => void
  onRestore: () => void
}) {
  const t = useT()

  if (tab === 'image' && imageStage === 'empty') {
    return (
      <button
        type="button"
        className={`${stageFrameCls} w-full cursor-pointer text-dim transition-colors duration-(--dur-fast) hover:text-txt focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px]`}
        onClick={onPick}
      >
        <span className="flex flex-col items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold">
          <MorphIcon icon={ImagePlus} size={22} strokeWidth={1.75} />
          {t('Choose an image')}
        </span>
      </button>
    )
  }

  if (tab === 'image' && imageStage === 'cuttingOut' && imageSrc && bgJob) {
    return (
      <div className={stageFrameCls}>
        <img src={imageSrc} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
        <CutoutOverlay job={bgJob} />
        <div className="absolute right-1.5 top-1.5 z-[1]">
          <Button variant="strong" onClick={onPick}>{t('Replace')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className={stageFrameCls}>
      <StickerPreview source={source} outlineWidth={outlineWidth} outlineColor={outlineColor} material={material} />
      {tab === 'image' && imageSrc && (
        <div className="absolute inset-x-0 top-0 z-[1] flex items-start justify-between gap-1.5 p-1.5">
          <div className="flex flex-wrap gap-1">
            {hasCutout
              ? <Button variant="strong" onClick={onRestore}>{t('Restore original')}</Button>
              : (
                  <Tip
                    label={t('AI runs locally · nothing is uploaded')}
                    trigger={<Button variant="strong" onClick={onRemoveBg}>{t('Remove background')}</Button>}
                  />
                )}
          </div>
          <Button variant="strong" onClick={onPick}>{t('Replace')}</Button>
        </div>
      )}
    </div>
  )
}

/**
 * Local U²-Netᵖ cutouts. Jobs are token-guarded: a second run while the
 * first still goes drops the stale result and frees its URL instead of
 * clobbering the newer pick.
 */
function useCutoutJob(onDone: (url: string) => void) {
  const [job, setJob] = useState<BgJob | null>(null)
  const jobRef = useRef(0)
  const t = useT()

  const run = (src: string) => {
    const token = ++jobRef.current
    const isCurrent = () => jobRef.current === token
    void cutoutBackground(
      src,
      (next) => {
        if (isCurrent())
          setJob(next)
      },
      (url) => {
        if (isCurrent())
          onDone(url)
        else
          URL.revokeObjectURL(url)
      },
      (reason) => {
        if (!isCurrent())
          return
        // Keep the reason readable without growing the toast: it is the only
        // diagnostic a phone ever sees.
        const detail = reason.length > 160 ? `${reason.slice(0, 157)}…` : reason
        say(`${t('Background removal failed')}: ${detail}`, { timeout: 8000 })
      },
    )
  }

  return { job, run }
}

/**
 * The sticker maker's picked image: the pick's own URL plus the cutout that
 * replaces it, each owned by the pick or cutout that made it. The cutout
 * runs automatically on pick; Restore original brings the full frame back.
 */
function useStickerImage() {
  const [pick, setPick] = useState<{ url: string, name: string } | null>(null)
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null)
  const pickRef = useRef<string | null>(null)
  const { job: bgJob, run: runCutout } = useCutoutJob(setCutoutUrl)

  // The displayed image: the cutout while one is showing, else the pick.
  const imageSrc = cutoutUrl ?? pick?.url ?? null
  const hasCutout = !!cutoutUrl

  // The pick's URL outlives the render that minted it, so the unmount cleanup
  // reaches it through the ref.
  useEffect(() => () => {
    if (pickRef.current)
      URL.revokeObjectURL(pickRef.current)
  }, [])

  // A sticker wants the subject alone, so the background is cut out as the
  // pick lands, not through a state round trip.
  const pickImage = () => {
    pickImageFiles((files) => {
      const file = files[0]
      if (!file)
        return
      // The pick owns the URL it mints: the release below drops the one it
      // replaces (after the mint, so the two are never the same), and the
      // unmount cleanup above drops the last one.
      const next = { url: URL.createObjectURL(file), name: file.name }
      if (pickRef.current)
        URL.revokeObjectURL(pickRef.current)
      pickRef.current = next.url
      setCutoutUrl(null)
      setPick(next)
      runCutout(next.url)
    })
  }

  // The displayed cutout's URL, owned until Restore drops it, a newer pick
  // replaces it, or the dialog goes.
  useEffect(() => {
    if (!cutoutUrl)
      return
    return () => URL.revokeObjectURL(cutoutUrl)
  }, [cutoutUrl])

  // Retry hook for the automatic cutout: used after Restore original or when
  // the local model failed.
  const removeBg = () => {
    if (!imageSrc || bgJob)
      return
    runCutout(imageSrc)
  }

  // Restore original: release the cutout, the display falls back to the pick.
  const restoreOriginal = () => {
    if (!cutoutUrl)
      return
    setCutoutUrl(null)
  }

  return { imageSrc, imageName: pick?.name ?? '', hasCutout, bgJob, pickImage, removeBg, restoreOriginal }
}

export function StickerMakerDialog({ open, paneId, onClose }: { open: boolean, paneId: string | null, onClose: () => void }) {
  const t = useT()

  const [tab, setTab] = useState<'text' | 'image'>('image')
  const [text, setText] = useState('')
  const [color, setColor] = useState(TEXT_COLOR_DEFAULT)
  const [background, setBackground] = useState<string | null>(BACKGROUND_DEFAULT)
  const [iconId, setIconId] = useState<string | null>(null)
  const [font, setFont] = useState(FONTS[0].id)
  const [outlineWidth, setOutlineWidth] = useState(OUTLINE_DEFAULT)
  const [outlineColor, setOutlineColor] = useState(OUTLINE_COLOR_DEFAULT)
  const [material, setMaterial] = useState<StickerMaterialType>('original')

  const [inserting, setInserting] = useState(false)
  const { imageSrc, imageName, hasCutout, bgJob, pickImage, removeBg, restoreOriginal } = useStickerImage()

  const fontMeta = FONTS.find(f => f.id === font) ?? FONTS[0]
  const activePresetId = STYLE_PRESETS.find(p => presetMatches(p, color, background, outlineColor))?.id ?? null

  const applyPreset = (preset: TextStylePreset) => {
    setColor(preset.color)
    setBackground(preset.background)
    setOutlineColor(preset.outlineColor)
  }

  const source = useMemo(
    () => buildSource(tab, text, color, background, fontMeta, iconId, imageSrc, imageName),
    [tab, text, color, background, fontMeta, iconId, imageSrc, imageName],
  )

  const imageStage = imageStageOf(imageSrc, bgJob)

  const insert = async () => {
    // Text stickers take their name from the first line, not a leftover image pick.
    const baseName = tab === 'text'
      ? (text.trim().split('\n')[0].slice(0, 24) || 'sticker')
      : (imageName.replace(/\.[^.]+$/, '') || 'sticker')
    setInserting(true)
    try {
      await insertSticker(source, paneId, { outlineWidth, outlineColor, material, baseName }, t, onClose)
    }
    catch {
      say(t('Failed to make sticker'))
    }
    finally {
      setInserting(false)
    }
  }

  const canInsert = !!source && !inserting && !bgJob

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-auto flex max-h-[min(86dvh,720px)] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-none border border-line bg-panel text-txt shadow-pop outline-0 transition-[opacity,translate,scale] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <header className="flex items-center justify-between gap-2.5 border-b border-line py-[11px] pl-4 pr-3">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">{t('Sticker maker')}</Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex gap-[5px]">
              <Button variant={tab === 'image' ? 'on' : 'flat'} aria-pressed={tab === 'image'} onClick={() => setTab('image')}>{t('Image')}</Button>
              <Button variant={tab === 'text' ? 'on' : 'flat'} aria-pressed={tab === 'text'} onClick={() => setTab('text')}>{t('Text')}</Button>
            </div>

            {tab === 'text' && (
              <div className="flex flex-col gap-2.5">
                <textarea
                  className="box-border min-h-[64px] w-full resize-none border border-line-strong bg-panel-2 px-2.5 py-2 text-[18px] leading-[1.3] text-txt outline-0 focus-visible:border-accent"
                  style={{ fontFamily: fontMeta.stack, fontWeight: fontMeta.weight }}
                  value={text}
                  placeholder={t('Type some text')}
                  onChange={e => setText(e.target.value)}
                  rows={2}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-dim">{t('Icon')}</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Icon')}>
                    <button
                      type="button"
                      aria-label={t('None')}
                      aria-pressed={iconId === null}
                      className={`${swatchBtnCls} w-auto min-w-[30px] px-1.5 flex items-center justify-center bg-panel-2 text-[10px] font-semibold text-dim ${iconId === null ? swatchActiveCls : ''}`}
                      onClick={() => setIconId(null)}
                    >
                      {t('None')}
                    </button>
                    {STICKER_ICONS.map(entry => (
                      <button
                        key={entry.id}
                        type="button"
                        aria-label={entry.label}
                        aria-pressed={iconId === entry.id}
                        className={`${swatchBtnCls} flex items-center justify-center bg-panel-2 text-txt ${iconId === entry.id ? swatchActiveCls : ''}`}
                        onClick={() => setIconId(entry.id)}
                      >
                        <MorphIcon icon={entry.icon} size={14} strokeWidth={1.75} />
                      </button>
                    ))}
                  </div>
                </div>
                <SelectField
                  label={t('Font')}
                  value={font}
                  items={FONTS.map(f => ({ value: f.id, label: t(f.label), fontFamily: f.stack }))}
                  onChange={setFont}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-dim">{t('Style')}</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Style')}>
                    {STYLE_PRESETS.map(preset => (
                      <Button
                        key={preset.id}
                        variant={activePresetId === preset.id ? 'on' : 'flat'}
                        aria-pressed={activePresetId === preset.id}
                        onClick={() => applyPreset(preset)}
                      >
                        {t(preset.label)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-dim">{t('Text color')}</span>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('Text color')}>
                    {TEXT_COLOR_SWATCHES.map(swatch => (
                      <button
                        key={swatch}
                        type="button"
                        aria-label={swatch}
                        aria-pressed={sameHex(color, swatch)}
                        className={`${swatchBtnCls} ${sameHex(color, swatch) ? swatchActiveCls : ''}`}
                        style={{ background: swatch }}
                        onClick={() => setColor(swatch)}
                      />
                    ))}
                  </div>
                  <ColorField label={t('Custom text color')} value={color} onChange={setColor} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-dim">{t('Background')}</span>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('Background')}>
                    {BACKGROUND_SWATCHES.map((swatch) => {
                      const active = swatch === null ? background === null : background !== null && sameHex(background, swatch)
                      return (
                        <button
                          key={swatch ?? 'none'}
                          type="button"
                          aria-label={swatch ?? t('Transparent')}
                          aria-pressed={active}
                          className={`${swatchBtnCls} ${active ? swatchActiveCls : ''} ${swatch === null ? 'swatch-clear' : ''}`}
                          style={swatch ? { background: swatch } : undefined}
                          onClick={() => setBackground(swatch)}
                        />
                      )
                    })}
                  </div>
                  <ColorField
                    label={t('Custom background')}
                    value={background ?? '#ffffff'}
                    onChange={setBackground}
                  />
                </div>
              </div>
            )}

            {/* Upload + live preview share one stage; cutout progress frosts the raw pick. */}
            <StickerStage
              tab={tab}
              imageStage={imageStage}
              imageSrc={imageSrc}
              bgJob={bgJob}
              hasCutout={hasCutout}
              source={source}
              outlineWidth={outlineWidth}
              outlineColor={outlineColor}
              material={material}
              onPick={pickImage}
              onRemoveBg={removeBg}
              onRestore={restoreOriginal}
            />

            <div className="flex flex-col gap-2.5 border-t border-line pt-3">
              <ColorField label={t('Outline color')} value={outlineColor} onChange={setOutlineColor} />
              <RangeField label={t('Outline width')} text={`${outlineWidth}`} max={40} value={outlineWidth} onChange={setOutlineWidth} />
              <SelectField
                label={t('Material')}
                value={material}
                items={MATERIALS.map(m => ({ value: m.value, label: t(m.label) }))}
                onChange={v => setMaterial(v as StickerMaterialType)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-[6px] border-t border-line px-3 py-2.5">
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="strong" disabled={!canInsert} onClick={insert}>
              {t('Insert')}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
