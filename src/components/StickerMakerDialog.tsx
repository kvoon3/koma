import type { StickerMaterialType, StickerSource } from '../lib/sticker'
import type { Perforation } from '../lib/stickerFX'
import { Dialog } from '@base-ui/react/dialog'
import { ImagePlus, Scissors, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StickerMaskEditor } from '@/components/StickerMaskEditor'
import { Button } from '@/components/ui/button'
import { buttonBase, buttonVariants } from '@/components/ui/buttonStyles'
import { ColorField, RangeField, SegmentedField, SelectField } from '@/components/ui/field'
import { Tip } from '@/components/ui/tip'
import { removeBackground } from '../lib/bgRemoval'
import { pickImageFiles } from '../lib/filePicker'
import { useT } from '../lib/i18n'
import { makeSticker } from '../lib/sticker'
import { perforationFromSliders } from '../lib/stickerFX'
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
/**
 * Stamp defaults, in the same design units as the outline width: at the
 * default border a hole is ~19px across and its neighbours ~28px apart on the
 * texture, which is the spacing a real die-cut stamp has (holes about as wide
 * as the gap between them).
 */
const HOLE_SIZE_DEFAULT = 8
const HOLE_SPACING_DEFAULT = 12
/** Text stickers read as black lettering inside a white die-cut border. */
const TEXT_COLOR_DEFAULT = '#000000'
const OUTLINE_COLOR_DEFAULT = '#ffffff'
const PREVIEW_MAX = 480
const INSERT_MAX = 960

const stageFrameCls = 'stage-clear relative flex h-[220px] items-center justify-center overflow-hidden border border-line-strong'

function buildSource(
  tab: 'text' | 'image',
  text: string,
  color: string,
  fontMeta: (typeof FONTS)[number],
  imageSrc: string | null,
  imageName: string,
): StickerSource | null {
  if (tab === 'text') {
    const value = text.trim()
    return value
      ? { type: 'text', text: value, color, fontFamily: fontMeta.stack, fontWeight: fontMeta.weight }
      : null
  }
  return imageSrc ? { type: 'image', src: imageSrc, name: imageName } : null
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
  style: { outlineWidth: number, outlineColor: string, material: StickerMaterialType, baseName: string, perforation: Perforation | null },
  t: (key: string) => string,
  onDone: () => void,
) {
  if (!source || !paneId)
    return
  const res = await makeSticker(source, {
    outlineWidth: style.outlineWidth,
    outlineColor: style.outlineColor,
    perforation: style.perforation,
    maxEdge: INSERT_MAX,
    material: { type: style.material, intensity: 1 },
  })
  const file = await dataUrlToFile(res.dataUrl, `${style.baseName || 'sticker'}.png`)
  const s = useStore.getState()
  const photo = s.addPhotos([file], false)[0]
  if (photo) {
    s.addSticker(photo.id, 0.5, 0.5)
    say(t('Sticker added'))
  }
  onDone()
}

/** Debounced live preview of the sticker the current inputs would produce. */
function StickerPreview({ source, outlineWidth, outlineColor, material, perforation }: {
  source: StickerSource | null
  outlineWidth: number
  outlineColor: string
  material: StickerMaterialType
  perforation: Perforation | null
}) {
  const t = useT()
  const [rendered, setRendered] = useState<{ key: string, url: string } | null>(null)
  const renderKey = useMemo(
    () => (source ? JSON.stringify([source, outlineWidth, outlineColor, material, perforation]) : ''),
    [source, outlineWidth, outlineColor, material, perforation],
  )

  // Live preview, debounced so typing / dragging a slider doesn't flood makeSticker.
  useEffect(() => {
    if (!source)
      return
    let alive = true
    const id = window.setTimeout(() => {
      makeSticker(source, { outlineWidth, outlineColor, perforation, maxEdge: PREVIEW_MAX, material: { type: material, intensity: 1 } })
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
  }, [source, outlineWidth, outlineColor, material, perforation, renderKey])

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
  perforation,
  onPick,
  onRemoveBg,
  onRestore,
  onAdjust,
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
  perforation: Perforation | null
  onPick: () => void
  onRemoveBg: () => void
  onRestore: () => void
  onAdjust: () => void
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
      <StickerPreview source={source} outlineWidth={outlineWidth} outlineColor={outlineColor} material={material} perforation={perforation} />
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
            <Button variant="strong" onClick={onAdjust}>
              <MorphIcon icon={Scissors} size={12} strokeWidth={1.75} />
              {t('Adjust cutout')}
            </Button>
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
  // The mask editor's committed cutout: a data URL, so it outlives no URL and
  // needs no revoke. It sits on top of the cutout, and the cutout sits on top
  // of the pick, so Restore original drops back through all three.
  const [manualUrl, setManualUrl] = useState<string | null>(null)
  const pickRef = useRef<string | null>(null)
  const { job: bgJob, run: runCutout } = useCutoutJob((url) => {
    setCutoutUrl(url)
    // A fresh cutout is a new subject: a mask made for the old one does not
    // describe it any more.
    setManualUrl(null)
  })

  // What the mask editor opens: the current cut before any manual edit.
  const baseSrc = cutoutUrl ?? pick?.url ?? null
  // The displayed image: the manual cutout, else the AI cutout, else the pick.
  const imageSrc = manualUrl ?? baseSrc
  const hasCutout = !!cutoutUrl || !!manualUrl

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
      setManualUrl(null)
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

  // Restore original: release the cutout and the manual mask, so the display
  // falls back to the pick itself.
  const restoreOriginal = () => {
    setCutoutUrl(null)
    setManualUrl(null)
  }

  return {
    imageSrc,
    baseSrc,
    imageName: pick?.name ?? '',
    hasCutout,
    bgJob,
    pickImage,
    removeBg,
    restoreOriginal,
    applyMask: (url: string) => setManualUrl(url),
  }
}

export function StickerMakerDialog({ open, paneId, onClose }: { open: boolean, paneId: string | null, onClose: () => void }) {
  const t = useT()

  const [tab, setTab] = useState<'text' | 'image'>('image')
  const [text, setText] = useState('')
  const [color, setColor] = useState(TEXT_COLOR_DEFAULT)
  const [font, setFont] = useState(FONTS[0].id)
  const [outlineWidth, setOutlineWidth] = useState(OUTLINE_DEFAULT)
  const [outlineColor, setOutlineColor] = useState(OUTLINE_COLOR_DEFAULT)
  const [material, setMaterial] = useState<StickerMaterialType>('original')
  const [stamp, setStamp] = useState(false)
  const [holeSize, setHoleSize] = useState(HOLE_SIZE_DEFAULT)
  const [holeSpacing, setHoleSpacing] = useState(HOLE_SPACING_DEFAULT)
  const [editingMask, setEditingMask] = useState(false)

  const [inserting, setInserting] = useState(false)
  const { imageSrc, baseSrc, imageName, hasCutout, bgJob, pickImage, removeBg, restoreOriginal, applyMask } = useStickerImage()

  const fontMeta = FONTS.find(f => f.id === font) ?? FONTS[0]

  const source = useMemo(
    () => buildSource(tab, text, color, fontMeta, imageSrc, imageName),
    [tab, text, color, fontMeta, imageSrc, imageName],
  )

  const imageStage = imageStageOf(imageSrc, bgJob)
  // The holes are punched through the same border the width slider draws, so
  // the perforation is a property of the outline pass, not a second sticker.
  const perforation = useMemo(
    () => (stamp ? perforationFromSliders(holeSize, holeSpacing) : null),
    [stamp, holeSize, holeSpacing],
  )

  const insert = async () => {
    // Text stickers take their name from the first line, not a leftover image pick.
    const baseName = tab === 'text'
      ? (text.trim().split('\n')[0].slice(0, 24) || 'sticker')
      : (imageName.replace(/\.[^.]+$/, '') || 'sticker')
    setInserting(true)
    try {
      await insertSticker(source, paneId, { outlineWidth, outlineColor, material, baseName, perforation }, t, onClose)
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
        <Dialog.Backdrop className="fixed z-(--z-modal) inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup className="fixed z-(--z-modal) left-1/2 top-1/2 flex max-h-[min(86dvh,720px)] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-none border border-line bg-panel text-txt shadow-pop outline-0 transition-[opacity,translate,scale] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
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
                <SelectField
                  label={t('Font')}
                  value={font}
                  items={FONTS.map(f => ({ value: f.id, label: t(f.label), fontFamily: f.stack }))}
                  onChange={setFont}
                />
                <ColorField label={t('Text color')} value={color} onChange={setColor} />
              </div>
            )}

            {/* Upload + live preview share one stage; cutout progress frosts the raw pick. */}
            {editingMask && baseSrc
              ? (
                  <StickerMaskEditor
                    key={imageSrc ?? baseSrc}
                    src={imageSrc ?? baseSrc}
                    onCancel={() => setEditingMask(false)}
                    onApply={(url) => {
                      applyMask(url)
                      setEditingMask(false)
                    }}
                  />
                )
              : (
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
                    perforation={perforation}
                    onPick={pickImage}
                    onRemoveBg={removeBg}
                    onRestore={restoreOriginal}
                    onAdjust={() => setEditingMask(true)}
                  />
                )}

            <div className="flex flex-col gap-2.5 border-t border-line pt-3">
              <ColorField label={t('Outline color')} value={outlineColor} onChange={setOutlineColor} />
              <RangeField label={t('Outline width')} text={`${outlineWidth}`} max={40} value={outlineWidth} onChange={setOutlineWidth} />
              <SegmentedField
                label={t('Edge')}
                value={stamp ? 'stamp' : 'smooth'}
                items={[
                  { value: 'smooth', label: t('Smooth') },
                  { value: 'stamp', label: t('Stamp') },
                ]}
                onChange={v => setStamp(v === 'stamp')}
              />
              {stamp && (
                <>
                  <RangeField label={t('Hole size')} text={`${holeSize}`} min={2} max={24} value={holeSize} onChange={setHoleSize} />
                  <RangeField label={t('Hole spacing')} text={`${holeSpacing}`} min={4} max={40} value={holeSpacing} onChange={setHoleSpacing} />
                </>
              )}
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
