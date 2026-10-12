import type { StickerMaterialType, StickerSource } from '../lib/sticker'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, buttonBase, buttonVariants } from '@/components/ui/button'
import { removeBackground } from '../lib/bgRemoval'
import { pickImageFiles } from '../lib/filePicker'
import { useT } from '../lib/i18n'
import { makeSticker } from '../lib/sticker'
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
const PREVIEW_MAX = 480
const INSERT_MAX = 960

const labelCls = 'text-[11.5px] text-dim'
const fieldCls = 'flex flex-col gap-1.5'
const inputCls = 'box-border h-[30px] w-full cursor-pointer rounded-none border border-line bg-panel-2 px-2 text-[12px] text-txt outline-0 focus-visible:border-accent'
const colorCls = 'box-border h-[30px] w-full cursor-pointer rounded-none border border-line bg-panel-2 p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0'

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
  onFail: () => void,
) {
  onJob({ phase: 'loading', progress: 0 })
  try {
    const blob = await fetch(imageSrc).then(r => r.blob())
    const cutout = await removeBackground(blob, p => onJob(p))
    onDone(URL.createObjectURL(cutout))
  }
  catch {
    onFail()
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
  return (
    <div className="stage-clear flex h-[220px] items-center justify-center overflow-hidden border border-line">
      {url
        ? <img src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
        : (
            <span className="text-[11.5px] text-faint">
              {rendering ? t('Rendering…') : t('Nothing to preview')}
            </span>
          )}
    </div>
  )
}

export function StickerMakerDialog({ open, paneId, onClose }: { open: boolean, paneId: string | null, onClose: () => void }) {
  const t = useT()

  const [tab, setTab] = useState<'text' | 'image'>('text')
  const [text, setText] = useState('')
  const [color, setColor] = useState('#ffffff')
  const [font, setFont] = useState(FONTS[0].id)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [outlineWidth, setOutlineWidth] = useState(OUTLINE_DEFAULT)
  const [outlineColor, setOutlineColor] = useState('#000000')
  const [material, setMaterial] = useState<StickerMaterialType>('original')

  const [inserting, setInserting] = useState(false)
  const [bgJob, setBgJob] = useState<{ phase: 'loading' | 'processing', progress?: number } | null>(null)
  const [hasCutout, setHasCutout] = useState(false)
  const urlRef = useRef<string | null>(null)
  const originalUrlRef = useRef<string | null>(null)

  const fontMeta = FONTS.find(f => f.id === font) ?? FONTS[0]

  const source = useMemo(
    () => buildSource(tab, text, color, fontMeta, imageSrc, imageName),
    [tab, text, color, fontMeta, imageSrc, imageName],
  )

  // Release the picked image's object URL on unmount (it stays alive while the
  // dialog is open so the preview and the insert both read the same bytes),
  // plus the pre-cutout original kept around for Restore.
  useEffect(() => () => {
    for (const url of [urlRef.current, originalUrlRef.current]) {
      if (url)
        URL.revokeObjectURL(url)
    }
  }, [])

  const pickImage = () => {
    pickImageFiles((files) => {
      const file = files[0]
      if (!file)
        return
      if (urlRef.current)
        URL.revokeObjectURL(urlRef.current)
      if (originalUrlRef.current)
        URL.revokeObjectURL(originalUrlRef.current)
      originalUrlRef.current = null
      setHasCutout(false)
      const url = URL.createObjectURL(file)
      urlRef.current = url
      setImageSrc(url)
      setImageName(file.name)
    })
  }

  // Swap the displayed image URL, keeping the pre-cutout original for Restore.
  const applyImage = (url: string, keepOriginal: boolean) => {
    if (keepOriginal) {
      // Ownership of the old URL moves to originalUrlRef; revoking urlRef
      // here would kill the original Restore needs (same URL).
      originalUrlRef.current = imageSrc
    }
    else {
      if (originalUrlRef.current)
        URL.revokeObjectURL(originalUrlRef.current)
      originalUrlRef.current = null
      if (urlRef.current)
        URL.revokeObjectURL(urlRef.current)
    }
    urlRef.current = url
    setImageSrc(url)
    setHasCutout(keepOriginal)
  }

  // Local U²-Netᵖ cutout: the preview and the insert both consume the new URL,
  // the original stays owned by originalUrlRef until restored or replaced.
  const removeBg = () => {
    if (!imageSrc || bgJob)
      return
    void cutoutBackground(
      imageSrc,
      setBgJob,
      url => applyImage(url, true),
      () => say(t('Background removal failed')),
    )
  }

  const restoreOriginal = () => {
    if (!originalUrlRef.current)
      return
    if (urlRef.current)
      URL.revokeObjectURL(urlRef.current)
    urlRef.current = originalUrlRef.current
    originalUrlRef.current = null
    setHasCutout(false)
    setImageSrc(urlRef.current)
  }

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
        <Dialog.Backdrop className="fixed inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-[180ms] ease-(--ease-out) data-ending-style:duration-[140ms] data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 flex max-h-[min(86dvh,720px)] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-none border border-line bg-panel text-txt shadow-pop outline-0 transition-[opacity,translate,scale] duration-[180ms] ease-(--ease-out) data-ending-style:duration-[140ms] data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <header className="flex items-center justify-between gap-2.5 border-b border-line py-[11px] pl-4 pr-3">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">{t('Sticker maker')}</Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex gap-[5px]">
              <Button variant={tab === 'text' ? 'on' : 'flat'} aria-pressed={tab === 'text'} onClick={() => setTab('text')}>{t('Text')}</Button>
              <Button variant={tab === 'image' ? 'on' : 'flat'} aria-pressed={tab === 'image'} onClick={() => setTab('image')}>{t('Image')}</Button>
            </div>

            {tab === 'text'
              ? (
                  <div className="flex flex-col gap-2.5">
                    <textarea
                      className="box-border min-h-[64px] w-full resize-none border border-line bg-panel-2 px-2.5 py-2 text-[18px] leading-[1.3] text-txt outline-0 focus-visible:border-accent"
                      style={{ fontFamily: fontMeta.stack, fontWeight: fontMeta.weight, color }}
                      value={text}
                      placeholder={t('Type some text')}
                      onChange={e => setText(e.target.value)}
                      rows={2}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <label className={fieldCls}>
                        <span className={labelCls}>{t('Text color')}</span>
                        <input type="color" className={colorCls} aria-label={t('Text color')} value={color} onChange={e => setColor(e.target.value)} />
                      </label>
                      <label className={fieldCls}>
                        <span className={labelCls}>{t('Font')}</span>
                        <select className={inputCls} value={font} onChange={e => setFont(e.target.value)}>
                          {FONTS.map(f => <option key={f.id} value={f.id}>{t(f.label)}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                )
              : (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <Button variant="strong" onClick={pickImage}>{t('Choose an image')}</Button>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
                        {imageSrc ? imageName : t('No image chosen')}
                      </span>
                    </div>
                    {imageSrc && (
                      <div className="flex items-center gap-2.5">
                        {hasCutout
                          ? (
                              <button
                                className="cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-accent underline underline-offset-2"
                                onClick={restoreOriginal}
                              >
                                {t('Restore original')}
                              </button>
                            )
                          : (
                              <Button variant="flat" disabled={!!bgJob} title={t('AI runs locally · nothing is uploaded')} onClick={() => void removeBg()}>
                                {t('Remove background')}
                              </Button>
                            )}
                        {bgJob && (
                          <span className="text-[11.5px] text-faint">
                            {bgJob.phase === 'loading'
                              ? `${t('Loading AI model…')} ${Math.round(bgJob.progress ?? 0)}%`
                              : t('Processing…')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

            <div className="flex flex-col gap-2.5 border-t border-line pt-3">
              <label className={fieldCls}>
                <span className={labelCls}>{`${t('Outline width')} · ${outlineWidth}`}</span>
                <input
                  type="range"
                  className="w-full cursor-pointer"
                  min={0}
                  max={40}
                  value={outlineWidth}
                  aria-label={t('Outline width')}
                  onChange={e => setOutlineWidth(Number(e.target.value))}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={fieldCls}>
                  <span className={labelCls}>{t('Outline color')}</span>
                  <input type="color" className={colorCls} aria-label={t('Outline color')} value={outlineColor} onChange={e => setOutlineColor(e.target.value)} />
                </label>
                <label className={fieldCls}>
                  <span className={labelCls}>{t('Material')}</span>
                  <select className={inputCls} value={material} onChange={e => setMaterial(e.target.value as StickerMaterialType)}>
                    {MATERIALS.map(m => <option key={m.value} value={m.value}>{t(m.label)}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className={fieldCls}>
              <span className={labelCls}>{t('Preview')}</span>
              <StickerPreview source={source} outlineWidth={outlineWidth} outlineColor={outlineColor} material={material} />
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
