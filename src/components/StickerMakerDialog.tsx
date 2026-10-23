import type { Translate } from '../lib/i18n'
import type { Photo } from '../lib/imageStore'
import type { TKey } from '../lib/locales/zh-Hans'
import type { StickerMaterialType, StickerSource } from '../lib/sticker'
import type { StickerBakeStyle, StickerTarget } from '../lib/stickerAssets'
import type { PerforationDesign } from '../lib/stickerFX'
import type { StickerOriginalInput, StickerRecipe } from '../lib/stickerRecipe'
import type { StickerTexture } from '../lib/stickerTexture'
import { Dialog } from '@base-ui/react/dialog'
import { Camera, ImagePlus, Images, Scissors, X } from 'lucide'
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
import { saveMadeSticker } from '../lib/stickerAssets'
import { MAX_TOOTH_DEPTH, MAX_TOOTH_SPACING, MIN_TOOTH_DEPTH, MIN_TOOTH_SPACING, perforationFromSliders } from '../lib/stickerFX'
import { editedStickerMeta, textOriginal } from '../lib/stickerRecipe'
import { say } from '../lib/toast'
import { CameraCapturePanel } from './sticker/CameraCapturePanel'
import { LibraryPickPanel } from './sticker/LibraryPickPanel'

/**
 * Text font choices: a small set of system stacks (no webfont download, so the
 * preview matches the export instantly). The rounded one is the "sticker" pick.
 */
const FONTS: { id: string, label: TKey, stack: string, weight: number }[] = [
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

const MATERIALS: { value: StickerMaterialType, label: TKey }[] = [
  { value: 'original', label: 'Original' },
  { value: 'holographic', label: 'Holographic' },
  { value: 'glitter', label: 'Glitter' },
]

/** The paper finishes: none, or the newspaper print. One tap, no strength. */
const PAPER_TEXTURES: { value: 'none' | StickerTexture, label: TKey }[] = [
  { value: 'none', label: 'None' },
  { value: 'newsprint', label: 'Newspaper' },
]

const OUTLINE_DEFAULT = 18
/**
 * Stamp defaults, in stage pixels (the sliders' own unit). The bite is a little
 * over half the default border's ~6px stage width, and the spacing leaves a
 * ~4px tooth between bites, so the edge reads as a perforation at 1x instead of
 * as a hairline. They are a screen measurement, not a texture one, so the same
 * numbers read the same on a phone and on a desktop.
 */
const TOOTH_DEPTH_DEFAULT = 4
const TOOTH_SPACING_DEFAULT = 12
/**
 * The stage before anything has been rendered into it: its designed height, so
 * the first bake of a session has a sane scale instead of falling back to 1:1.
 * Every later bake measures the preview's real drawn size.
 */
const STAGE_HEIGHT_DEFAULT = 220
/** Text stickers read as black lettering inside a white die-cut border. */
const TEXT_COLOR_DEFAULT = '#000000'
const OUTLINE_COLOR_DEFAULT = '#ffffff'
const PREVIEW_MAX = 480

/**
 * `shrink-0` keeps the stage at its designed height: the dialog body is the
 * scrolling half, so on a short window (a landscape phone is 412px tall) the
 * stage scrolls instead of collapsing to a 30px strip with its chips clipped.
 */
const stageFrameCls = 'stage-clear relative flex h-[220px] shrink-0 items-center justify-center overflow-hidden border border-line-strong'

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

/** Debounced live preview of the sticker the current inputs would produce. */
function StickerPreview({ source, outlineWidth, outlineColor, material, perforation, texture, displayLongEdge, onDisplaySize }: {
  source: StickerSource | null
  outlineWidth: number
  outlineColor: string
  material: StickerMaterialType
  perforation: PerforationDesign | null
  texture: StickerTexture | null
  displayLongEdge: number
  onDisplaySize: (longEdge: number) => void
}) {
  const t = useT()
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [rendered, setRendered] = useState<{ key: string, url: string } | null>(null)
  const renderKey = useMemo(
    () => (source ? JSON.stringify([source, outlineWidth, outlineColor, material, perforation, texture, Math.round(displayLongEdge)]) : ''),
    [source, outlineWidth, outlineColor, material, perforation, texture, displayLongEdge],
  )

  // The stage is what the stamp sliders are measured against, so the drawn size
  // of the preview is read back here: `object-contain` in a fixed frame makes
  // it a function of the frame and the artwork's aspect, not of the window.
  const drawn = rendered?.key === renderKey ? rendered?.url : null
  useEffect(() => {
    const image = imageRef.current
    if (!image || !drawn)
      return
    const report = () => {
      const rect = image.getBoundingClientRect()
      const longEdge = Math.max(rect.width, rect.height)
      if (longEdge > 0)
        onDisplaySize(longEdge)
    }
    report()
    if (typeof ResizeObserver === 'undefined')
      return
    const observer = new ResizeObserver(report)
    observer.observe(image)
    return () => observer.disconnect()
  }, [drawn, onDisplaySize])

  // Live preview, debounced so typing / dragging a slider doesn't flood makeSticker.
  useEffect(() => {
    if (!source)
      return
    let alive = true
    const id = window.setTimeout(() => {
      makeSticker(source, { outlineWidth, outlineColor, perforation, texture, displayLongEdge, maxEdge: PREVIEW_MAX, material: { type: material, intensity: 1 } })
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
  }, [source, outlineWidth, outlineColor, material, perforation, texture, displayLongEdge, renderKey])

  const url = source && rendered?.key === renderKey ? rendered.url || null : null
  const rendering = !!source && rendered?.key !== renderKey
  if (url) {
    return <img ref={imageRef} src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
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
  texture,
  displayLongEdge,
  onDisplaySize,
  onPick,
  onTakePhoto,
  onRemoveBg,
  onRestore,
  onAdjust,
  onPickLibrary = null,
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
  perforation: PerforationDesign | null
  texture: StickerTexture | null
  displayLongEdge: number
  onDisplaySize: (longEdge: number) => void
  onPick: () => void
  onTakePhoto: () => void
  onRemoveBg: () => void
  onRestore: () => void
  onAdjust: () => void
  /** Library mode only: pick the source from the photo library instead of a file. */
  onPickLibrary?: (() => void) | null
}) {
  const t = useT()

  if (tab === 'image' && imageStage === 'empty') {
    const label = (
      <span className="flex flex-col items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold">
        <MorphIcon icon={ImagePlus} size={22} strokeWidth={1.75} />
        {t('Choose an image')}
      </span>
    )
    const cameraLabel = (
      <span className="flex items-center gap-2 whitespace-nowrap text-[12.5px] font-semibold">
        <MorphIcon icon={Camera} size={18} strokeWidth={1.75} />
        {t('Take a photo')}
      </span>
    )
    const cls = 'cursor-pointer text-dim transition-colors duration-(--dur-fast) hover:text-txt focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px]'
    if (onPickLibrary) {
      return (
        <div className={`${stageFrameCls} flex-col divide-y divide-line-strong`} data-sticker-stage="empty">
          <button type="button" className={`flex h-1/2 w-full items-center justify-center ${cls}`} onClick={onPick}>
            {label}
          </button>
          <div className="flex h-1/2 w-full divide-x divide-line-strong">
            <button type="button" className={`flex w-1/2 items-center justify-center ${cls}`} data-camera-open="" onClick={onTakePhoto}>
              {cameraLabel}
            </button>
            <button type="button" className={`flex w-1/2 items-center justify-center gap-2 text-[12.5px] font-semibold ${cls}`} onClick={onPickLibrary}>
              <MorphIcon icon={Images} size={18} strokeWidth={1.75} />
              {t('From the photo library')}
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className={`${stageFrameCls} flex-col divide-y divide-line-strong`} data-sticker-stage="empty">
        <button type="button" className={`flex h-1/2 w-full items-center justify-center ${cls}`} onClick={onPick}>
          {label}
        </button>
        <button type="button" className={`flex h-1/2 w-full items-center justify-center ${cls}`} data-camera-open="" onClick={onTakePhoto}>
          {cameraLabel}
        </button>
      </div>
    )
  }

  if (tab === 'image' && imageStage === 'cuttingOut' && imageSrc && bgJob) {
    return (
      <div className={stageFrameCls} data-sticker-stage="cuttingOut">
        <img src={imageSrc} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
        <CutoutOverlay job={bgJob} />
        <div className="absolute right-1.5 top-1.5 z-[1]">
          <Button variant="strong" onClick={onPick}>{t('Replace')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className={stageFrameCls} data-sticker-stage="ready">
      <StickerPreview
        source={source}
        outlineWidth={outlineWidth}
        outlineColor={outlineColor}
        material={material}
        perforation={perforation}
        texture={texture}
        displayLongEdge={displayLongEdge}
        onDisplaySize={onDisplaySize}
      />
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
          <div className="flex flex-none items-center gap-1">
            <Button variant="strong" data-camera-open="" onClick={onTakePhoto}>
              <MorphIcon icon={Camera} size={12} strokeWidth={1.75} />
              {t('Take a photo')}
            </Button>
            <Button variant="strong" onClick={onPick}>{t('Replace')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Local U²-Netᵖ cutouts. Jobs are token-guarded: a second run while the
 * first still goes drops the stale result and frees its URL instead of
 * clobbering the newer pick.
 *
 * `auto` is a source to cut as soon as the maker mounts. A re-edit opens on the
 * original and its cutout is not a user gesture, so the job starts here, in the
 * hook that owns it: the stage is in its "cutting out" state from the first
 * paint, and once per mount (each opening of the maker is its own mount).
 */
function useCutoutJob(onDone: (url: string) => void, auto: string | null = null) {
  const [job, setJob] = useState<BgJob | null>(auto ? { phase: 'loading', progress: 0 } : null)
  const jobRef = useRef(0)
  const t = useT()
  const tRef = useRef(t)
  const doneRef = useRef(onDone)
  useEffect(() => {
    tRef.current = t
    doneRef.current = onDone
  })

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
          doneRef.current(url)
        else
          URL.revokeObjectURL(url)
      },
      (reason) => {
        if (!isCurrent())
          return
        // Keep the reason readable without growing the toast: it is the only
        // diagnostic a phone ever sees.
        const detail = reason.length > 160 ? `${reason.slice(0, 157)}…` : reason
        say(`${tRef.current('Background removal failed')}: ${detail}`, { timeout: 8000 })
      },
    )
  }

  // The mount's own run. Reached through refs so the effect fires exactly once:
  // `auto` is a fresh string every render of the dialog above, and a dep on it
  // would restart the model on every keystroke.
  const autoRef = useRef(auto)
  const runRef = useRef(run)
  const startedRef = useRef(false)
  useEffect(() => {
    runRef.current = run
  })
  useEffect(() => {
    const src = autoRef.current
    if (!src || startedRef.current)
      return
    startedRef.current = true
    runRef.current(src)
  }, [])

  return { job, run }
}

/**
 * The sticker maker's picked image: the pick's own URL plus the cutout that
 * replaces it, each owned by the pick or cutout that made it. The cutout
 * runs automatically on pick; Restore original brings the full frame back.
 *
 * `initial` is the ORIGINAL a re-edit starts from (see lib/stickerRecipe): the
 * un-cut picture the sticker was made from, its name, and the library photo it
 * came from when it came from one. It enters as the pick and the cutout job runs
 * on it again, so a re-edit re-cuts the original rather than inheriting pixels
 * that were already cut. The original itself is what a save carries forward:
 * `original()` is the picked File, or the stored data URL when nothing was
 * re-picked.
 */
function useStickerImage(initial: { url: string, name: string, photoId?: string } | null = null) {
  const [pick, setPick] = useState<{ url: string, name: string } | null>(initial ? { url: initial.url, name: initial.name } : null)
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null)
  /**
   * The picture this sticker is being made from, as the save needs it: the
   * picked File (encoded at save time) or the stored original a re-edit carries
   * untouched. A fresh pick replaces it, which is why it is a ref and not a
   * field of the mounted seed.
   */
  const originalRef = useRef<StickerOriginalInput | null>(
    initial ? { type: 'image', src: initial.url, name: initial.name, photoId: initial.photoId } : null,
  )
  // The mask editor's committed cutout: a data URL, so it outlives no URL and
  // needs no revoke. It sits on top of the cutout, and the cutout sits on top
  // of the pick, so Restore original drops back through all three.
  const [manualUrl, setManualUrl] = useState<string | null>(null)
  const pickRef = useRef<string | null>(null)
  // A re-edit's original is the mount's auto job: see useCutoutJob.
  const { job: bgJob, run: runCutout } = useCutoutJob((url) => {
    setCutoutUrl(url)
    // A fresh cutout is a new subject: a mask made for the old one does not
    // describe it any more.
    setManualUrl(null)
  }, initial?.url ?? null)

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

  // A sticker wants the subject alone, so the background is cut out as the pick
  // lands, not through a state round trip. `loadFile` is the one door into the
  // stage: the file picker hands it a File, the photo library hands it the File
  // behind the picked photo.
  const loadFile = (file: File) => {
    // The pick owns the URL it mints: the release below drops the one it
    // replaces (after the mint, so the two are never the same), and the
    // unmount cleanup above drops the last one.
    const next = { url: URL.createObjectURL(file), name: file.name }
    if (pickRef.current)
      URL.revokeObjectURL(pickRef.current)
    pickRef.current = next.url
    // A new pick is a new original: the recipe the save writes starts here.
    originalRef.current = { type: 'image', file, name: file.name }
    setCutoutUrl(null)
    setManualUrl(null)
    setPick(next)
    runCutout(next.url)
  }

  const pickImage = () => {
    pickImageFiles((files) => {
      if (files[0])
        loadFile(files[0])
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
    loadFile,
    removeBg,
    restoreOriginal,
    applyMask: (url: string) => setManualUrl(url),
    /** The picture this sticker is being made from (see `originalRef`). */
    original: () => originalRef.current,
  }
}

/** The controls a fresh make starts from, or the ones a sticker was saved with. */
interface MakerSeed {
  tab: 'text' | 'image'
  text: string
  color: string
  font: string
  outlineWidth: number
  outlineColor: string
  material: StickerMaterialType
  stamp: boolean
  toothDepth: number
  toothSpacing: number
  displayLongEdge: number
  texture: StickerTexture | null
  /** The ORIGINAL a re-edit opens on (a recipe's stored picture), if any. */
  image: { url: string, name: string, photoId?: string } | null
}

/**
 * A re-edit opens on the original picture, holding every control the sticker
 * was saved with; a fresh make opens empty. The recipe is read once, here, so
 * the component below only ever sees values (`lib/stickerRecipe`).
 */
function seedOf(edit: { recipe: StickerRecipe } | null): MakerSeed {
  const original = edit?.recipe.original ?? null
  const style = edit?.recipe.style ?? null
  const words = original?.type === 'text' ? original : null
  return {
    tab: words ? 'text' : 'image',
    text: words?.text ?? '',
    color: words?.color ?? TEXT_COLOR_DEFAULT,
    font: words?.fontId ?? FONTS[0].id,
    outlineWidth: style?.outlineWidth ?? OUTLINE_DEFAULT,
    outlineColor: style?.outlineColor ?? OUTLINE_COLOR_DEFAULT,
    material: style?.material ?? 'original',
    // The stamp sliders' own unit is what the recipe stores (`PerforationDesign`
    // is the clamped slider pair), so the controls come back exactly as saved.
    stamp: !!style?.perforation,
    toothDepth: style?.perforation?.depth ?? TOOTH_DEPTH_DEFAULT,
    toothSpacing: style?.perforation?.spacing ?? TOOTH_SPACING_DEFAULT,
    displayLongEdge: style?.displayLongEdge ?? STAGE_HEIGHT_DEFAULT,
    texture: style?.texture ?? null,
    image: original?.type === 'image' ? { url: original.src, name: original.name, photoId: original.photoId } : null,
  }
}

/** The dialog's own labels: a re-edit says so in the title, and in the DOM for the tests. */
function dialogLabels(edit: { photo: Photo } | null, t: Translate): { title: string, mode: string } {
  return edit ? { title: t('Re-edit sticker'), mode: 'reedit' } : { title: t('Sticker maker'), mode: 'new' }
}

/** The name a bake files under: the sticker it came from, or the maker's own. */
function baseNameOf(reEdit: { photo: Photo } | null, tab: 'text' | 'image', text: string, imageName: string): string {
  if (reEdit)
    return editedStickerMeta(reEdit.photo, 'rebaked').baseName
  // Text stickers take their name from the first line, not a leftover image pick.
  if (tab === 'text')
    return text.trim().split('\n')[0].slice(0, 24) || 'sticker'
  return imageName.replace(/\.[^.]+$/, '') || 'sticker'
}

/**
 * The original this save carries forward, so the NEW record is re-editable too
 * (see lib/stickerRecipe). A text sticker's original is its spec; an image
 * sticker's is the picture the maker started from (`useStickerImage`'s ref: the
 * fresh pick, or the stored original when a re-edit changed nothing about the
 * subject). It is never the cutout: that is a step, not a source.
 */
function originalOf(tab: 'text' | 'image', text: string, color: string, font: string, picked: StickerOriginalInput | null): StickerOriginalInput | null {
  if (tab === 'text')
    return text.trim() ? textOriginal(text.trim(), color, font) : null
  return picked
}

/**
 * The dialog's save row. A re-edit says what it is about to do before it does
 * it: a save is a new record, never a rewrite, so the copies already placed
 * keep drawing the asset they were placed from. Its own row, so a phone never
 * squeezes the sentence against the buttons.
 */
function MakerFooter({ reEdit, canInsert, saveLabel, onClose, onInsert, onReset }: {
  reEdit: boolean
  canInsert: boolean
  saveLabel: string
  onClose: () => void
  onInsert: () => void
  /** Back to the values the sticker was saved with (a re-edit's seeded defaults). */
  onReset: () => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
      {reEdit && (
        <span className="text-[10.5px] leading-[1.35] text-faint" data-sticker-reedit-note="">
          {t('Saves a new sticker · placed copies keep their pixels')}
        </span>
      )}
      <div className="flex items-center justify-end gap-[6px]">
        {/* The saved style is a starting point, not a lock: it can go back. */}
        {reEdit && (
          <span className="mr-auto flex">
            <Button onClick={onReset} data-sticker-reset-effects="">{t('Reset effects')}</Button>
          </span>
        )}
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="strong" disabled={!canInsert} onClick={onInsert} data-sticker-save="">
          {saveLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * The sticker maker, one dialog with three doors: the editor's Make tool hands
 * it a pane (`target.kind === 'pane'`, the sticker is pinned onto the board),
 * the sticker page hands it a folder (`'library'`, the sticker is filed in the
 * library and no board is touched), and the sticker page's **Re-edit** hands it
 * a recipe (`reEdit`, the dialog opens holding the subject and every control
 * the sticker was saved with). Everything above the save is shared: the same
 * stage, cutout, edge effects and mask editor, and every door saves a NEW
 * record rather than rewriting one.
 */
/** The Text / Image door pair above the stage. */
function MakerTabs({ tab, onChange }: { tab: 'text' | 'image', onChange: (tab: 'text' | 'image') => void }) {
  const t = useT()
  return (
    <div className="flex gap-[5px]">
      <Button variant={tab === 'image' ? 'on' : 'flat'} aria-pressed={tab === 'image'} onClick={() => onChange('image')}>{t('Image')}</Button>
      <Button variant={tab === 'text' ? 'on' : 'flat'} aria-pressed={tab === 'text'} onClick={() => onChange('text')}>{t('Text')}</Button>
    </div>
  )
}

/** The text tab's subject: what the sticker says, in which face and colour. */
function MakerTextFields({ text, font, fontMeta, color, onText, onFont, onColor }: {
  text: string
  font: string
  fontMeta: typeof FONTS[number]
  color: string
  onText: (text: string) => void
  onFont: (font: string) => void
  onColor: (color: string) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2.5">
      <textarea
        className="box-border min-h-[64px] w-full resize-none border border-line-strong bg-panel-2 px-2.5 py-2 text-[18px] leading-[1.3] text-txt outline-0 focus-visible:border-accent"
        style={{ fontFamily: fontMeta.stack, fontWeight: fontMeta.weight }}
        value={text}
        placeholder={t('Type some text')}
        onChange={e => onText(e.target.value)}
        rows={2}
      />
      <SelectField
        label={t('Font')}
        value={font}
        items={FONTS.map(f => ({ value: f.id, label: t(f.label), fontFamily: f.stack }))}
        onChange={onFont}
      />
      <ColorField label={t('Text color')} value={color} onChange={onColor} />
    </div>
  )
}

/** Which door fills the stage slot. One at a time, by construction. */
type StageView = 'stage' | 'camera' | 'library' | 'mask'

/**
 * What fills the stage slot: the library picker, the mask editor, or the live
 * stage. One door at a time, in the order the page offers them.
 */
function MakerStageSlot({
  view,
  baseSrc,
  imageSrc,
  onCancelCamera,
  onCapture,
  onCancelPick,
  onPickPhoto,
  onApplyMask,
  onCancelMask,
  stage,
}: {
  view: StageView
  baseSrc: string | null
  imageSrc: string | null
  onCancelCamera: () => void
  onCapture: (file: File) => void
  onCancelPick: () => void
  onPickPhoto: (photo: Photo) => void
  onApplyMask: (url: string) => void
  onCancelMask: () => void
  stage: React.ComponentProps<typeof StickerStage>
}) {
  // The panels belong to the image source, so the text tab always shows the
  // stage even if a panel was open in the commit before the tab changed.
  if (stage.tab !== 'image')
    return <StickerStage {...stage} />
  if (view === 'camera')
    return <CameraCapturePanel onCapture={onCapture} onCancel={onCancelCamera} />
  if (view === 'library')
    return <LibraryPickPanel onCancel={onCancelPick} onPick={onPickPhoto} />
  if (view === 'mask' && baseSrc)
    return <StickerMaskEditor key={imageSrc ?? baseSrc} src={imageSrc ?? baseSrc} onCancel={onCancelMask} onApply={onApplyMask} />
  return <StickerStage {...stage} />
}

/** The edge effects: outline, stamp teeth, material and the paper finish. */
function MakerEffectsFields({
  outlineWidth,
  outlineColor,
  material,
  stamp,
  toothDepth,
  toothSpacing,
  texture,
  onOutlineWidth,
  onOutlineColor,
  onMaterial,
  onStamp,
  onToothDepth,
  onToothSpacing,
  onTexture,
}: {
  outlineWidth: number
  outlineColor: string
  material: StickerMaterialType
  stamp: boolean
  toothDepth: number
  toothSpacing: number
  texture: StickerTexture | null
  onOutlineWidth: (width: number) => void
  onOutlineColor: (color: string) => void
  onMaterial: (material: StickerMaterialType) => void
  onStamp: (stamp: boolean) => void
  onToothDepth: (depth: number) => void
  onToothSpacing: (spacing: number) => void
  onTexture: (texture: StickerTexture | null) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      <ColorField label={t('Outline color')} value={outlineColor} onChange={onOutlineColor} />
      <RangeField label={t('Outline width')} text={`${outlineWidth}`} max={40} value={outlineWidth} onChange={onOutlineWidth} />
      <SegmentedField
        label={t('Edge')}
        value={stamp ? 'stamp' : 'smooth'}
        items={[
          { value: 'smooth', label: t('Smooth') },
          { value: 'stamp', label: t('Stamp') },
        ]}
        onChange={v => onStamp(v === 'stamp')}
      />
      {stamp && (
        <>
          <RangeField label={t('Tooth depth')} text={`${toothDepth}`} min={MIN_TOOTH_DEPTH} max={MAX_TOOTH_DEPTH} value={toothDepth} onChange={onToothDepth} />
          <RangeField label={t('Tooth spacing')} text={`${toothSpacing}`} min={MIN_TOOTH_SPACING} max={MAX_TOOTH_SPACING} value={toothSpacing} onChange={onToothSpacing} />
        </>
      )}
      <SelectField
        label={t('Material')}
        value={material}
        items={MATERIALS.map(m => ({ value: m.value, label: t(m.label) }))}
        onChange={v => onMaterial(v as StickerMaterialType)}
      />
      <div data-sticker-paper={texture ?? 'none'}>
        <SegmentedField
          label={t('Paper texture')}
          value={texture ?? 'none'}
          items={PAPER_TEXTURES.map(item => ({ value: item.value, label: t(item.label) }))}
          onChange={value => onTexture(value === 'none' ? null : value as StickerTexture)}
        />
      </div>
    </div>
  )
}

export function StickerMakerDialog({ open, target, onClose, reEdit = null }: {
  open: boolean
  target: StickerTarget | null
  onClose: () => void
  /**
   * The sticker being modified, with the recipe it carries (see
   * lib/stickerRecipe). Null for a fresh make. Every control above starts from
   * the recipe's values, so what the dialog shows is what the bake will do.
   */
  reEdit?: { photo: Photo, recipe: StickerRecipe } | null
}) {
  const t = useT()
  const { title, mode } = dialogLabels(reEdit, t)
  // Read once per opening (the page remounts the dialog), so every control
  // below starts from the recipe rather than from the last make.
  const seed = seedOf(reEdit)

  const [tab, setTab] = useState<'text' | 'image'>(seed.tab)
  const [text, setText] = useState(seed.text)
  const [color, setColor] = useState(seed.color)
  const [font, setFont] = useState(seed.font)
  const [outlineWidth, setOutlineWidth] = useState(seed.outlineWidth)
  const [outlineColor, setOutlineColor] = useState(seed.outlineColor)
  const [material, setMaterial] = useState<StickerMaterialType>(seed.material)
  const [stamp, setStamp] = useState(seed.stamp)
  const [toothDepth, setToothDepth] = useState(seed.toothDepth)
  const [toothSpacing, setToothSpacing] = useState(seed.toothSpacing)
  const [displayLongEdge, setDisplayLongEdge] = useState(seed.displayLongEdge)
  const [texture, setTexture] = useState<StickerTexture | null>(seed.texture)
  // The board host keeps this dialog mounted, so the transient stage panel is
  // keyed by the state that should reset it: a close or a tab change reads as
  // the stage again, with no effect and no extra render.
  const viewKey = `${open ? 'open' : 'closed'}:${tab}`
  const [stageViewAt, setStageViewAt] = useState<{ key: string, view: StageView }>({ key: viewKey, view: 'stage' })
  const stageView = stageViewAt.key === viewKey ? stageViewAt.view : 'stage'
  const setStageView = (view: StageView) => setStageViewAt({ key: viewKey, view })

  const [inserting, setInserting] = useState(false)
  const { imageSrc, baseSrc, imageName, hasCutout, bgJob, pickImage, loadFile, removeBg, restoreOriginal, applyMask, original } = useStickerImage(seed.image)
  const libraryMode = target?.kind === 'library'

  const fontMeta = FONTS.find(f => f.id === font) ?? FONTS[0]

  const source = useMemo(
    () => buildSource(tab, text, color, fontMeta, imageSrc, imageName),
    [tab, text, color, fontMeta, imageSrc, imageName],
  )

  const imageStage = imageStageOf(imageSrc, bgJob)
  // The teeth are punched through the same border the width slider draws, so
  // the perforation is a property of the outline pass, not a second sticker.
  // Its numbers are stage pixels; the bake converts them (see StickerPreview).
  const perforation = useMemo(
    () => (stamp ? perforationFromSliders(toothDepth, toothSpacing) : null),
    [stamp, toothDepth, toothSpacing],
  )
  const insert = async () => {
    if (!source || !target)
      return
    const baseName = baseNameOf(reEdit, tab, text, imageName)
    const style: StickerBakeStyle = { outlineWidth, outlineColor, material, baseName, perforation, displayLongEdge, texture }
    // The picture this sticker started from, carried onto the new record.
    const fromOriginal = originalOf(tab, text, color, font, original())
    setInserting(true)
    try {
      // Bake once, land it where this door wants it (lib/stickerAssets).
      await saveMadeSticker(source, style, target, t, fromOriginal)
      onClose()
    }
    catch {
      say(t('Failed to make sticker'))
    }
    finally {
      setInserting(false)
    }
  }

  /** The saved style, back in the controls (a re-edit's starting point). */
  const resetEffects = () => {
    setOutlineWidth(seed.outlineWidth)
    setOutlineColor(seed.outlineColor)
    setMaterial(seed.material)
    setStamp(seed.stamp)
    setToothDepth(seed.toothDepth)
    setToothSpacing(seed.toothSpacing)
    setTexture(seed.texture)
  }

  const canInsert = !!source && !!target && !inserting && !bgJob && stageView !== 'camera'
  /** The library target's folder, in the reader's own words ('' is Unsorted). */
  const saveLabel = target?.kind === 'library'
    ? t('Save to {folder}', { folder: target.folder || t('Unsorted') })
    : t('Insert')

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o)
          return
        onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed z-(--z-modal) inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup data-sticker-maker={mode} className="fixed z-(--z-modal) left-1/2 top-1/2 flex max-h-[min(86dvh,720px)] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-none border border-line bg-panel text-txt shadow-pop outline-0 transition-[opacity,translate,scale] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <header className="flex items-center justify-between gap-2.5 border-b border-line py-[11px] pl-4 pr-3">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <MakerTabs tab={tab} onChange={setTab} />

            {tab === 'text' && (
              <MakerTextFields
                text={text}
                font={font}
                fontMeta={fontMeta}
                color={color}
                onText={setText}
                onFont={setFont}
                onColor={setColor}
              />
            )}

            {/* Upload + live preview share one stage; cutout progress frosts the raw pick. */}
            <MakerStageSlot
              view={stageView}
              baseSrc={baseSrc}
              imageSrc={imageSrc}
              onCancelCamera={() => setStageView('stage')}
              onCapture={(file) => {
                setStageView('stage')
                loadFile(file)
              }}
              onCancelPick={() => setStageView('stage')}
              onPickPhoto={(photo: Photo) => {
                setStageView('stage')
                // The photo's own File is the source, so the cutout, the
                // effects and the bake are the ones a file pick runs.
                loadFile(photo.file)
              }}
              onApplyMask={(url) => {
                applyMask(url)
                setStageView('stage')
              }}
              onCancelMask={() => setStageView('stage')}
              stage={{
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
                texture,
                displayLongEdge,
                onDisplaySize: setDisplayLongEdge,
                onPick: pickImage,
                onTakePhoto: () => setStageView('camera'),
                onRemoveBg: removeBg,
                onRestore: restoreOriginal,
                onAdjust: () => setStageView('mask'),
                onPickLibrary: libraryMode ? () => setStageView('library') : null,
              }}
            />

            <MakerEffectsFields
              outlineWidth={outlineWidth}
              outlineColor={outlineColor}
              material={material}
              stamp={stamp}
              toothDepth={toothDepth}
              toothSpacing={toothSpacing}
              texture={texture}
              onOutlineWidth={setOutlineWidth}
              onOutlineColor={setOutlineColor}
              onMaterial={setMaterial}
              onStamp={setStamp}
              onToothDepth={setToothDepth}
              onToothSpacing={setToothSpacing}
              onTexture={setTexture}
            />
          </div>

          <MakerFooter
            reEdit={!!reEdit}
            canInsert={canInsert}
            saveLabel={saveLabel}
            onClose={onClose}
            onInsert={insert}
            onReset={resetEffects}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
