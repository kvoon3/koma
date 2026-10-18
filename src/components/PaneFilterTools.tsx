import type { FilterId, FilterKnob, FilterSpec, FilterValue } from '../lib/filters'
import type { Photo } from '../lib/imageStore'
import { Popover } from '@base-ui/react/popover'
import { Blend, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useRef, useState } from 'react'
import { getFilterSwatch, peekFilterSwatch } from '../lib/filterCache'
import { defaultFilter, FILTER_IDS, FILTER_PARAMS, filterKey, resolveFilter } from '../lib/filters'
import { useT } from '../lib/i18n'
import { findLeaf } from '../lib/panes'
import { activeWs, useStore } from '../store'
import { toolsBtnCls, toolsLabelCls } from './ToolsDock'
import { AppSlider } from './ui/field'
import { dockBtnStateCls, dockPopupMotionCls, menuSurfaceCls } from './ui/menu'

/**
 * The drawer's texture tool: one button in the pane tools that opens a palette
 * of fourteen filters (see `lib/filters`), each swatch rendered from the
 * focused pane's own photo, plus None to clear. A sibling of the pane tools
 * rather than a member of their list, so the dock's order and the tools'
 * existing layout are untouched (Stage.tsx renders it once, like the rotation
 * dial next to it).
 *
 * The eight textures are frozen presets; the six pixel filters (mosaic, tiles,
 * screens, ordered dithers) take parameters, and the strip under the grid dials
 * the ACTIVE pane's own setting: a stage-pixel block, tile or cell, a posterise
 * level count, a screen angle, an ink mode. The swatch of the active filter is
 * drawn from that same setting, so the tile shows the granularity being dialled,
 * and its bitmap is the very preview the pane is showing (one cache entry, no
 * second filter pass).
 *
 * Picking a filter commits one undo step (`setPaneFilter`); a parameter drag
 * streams and coalesces under one tag, like a rotation. The pane's preview swaps
 * to the filtered bitmap the exporter also draws, so what the swatch shows is
 * what the export prints.
 */

/** English source names, the keys both dictionaries translate. */
const FILTER_LABEL: Record<FilterId, string> = {
  grain: 'Film Grain',
  duotoneWarm: 'Warm Duotone',
  duotoneCool: 'Cool Duotone',
  duotoneSepia: 'Sepia Duotone',
  print: 'Two-Ink Print',
  cyanotype: 'Cyanotype',
  paper: 'Paper Tone',
  bitgrain: 'Bit Grain',
  mosaic: 'Mosaic',
  tessera: 'Tessera',
  diamond: 'Diamond Screen',
  halftone: 'Halftone',
  bayerMono: 'Dither Mono',
  bayerColor: 'Dither Color',
}

/**
 * What each knob is called on each filter: the same dial is a block, a tile, a
 * dot pitch or a dither cell, and the label is what says so. Frozen textures
 * take none.
 */
const KNOB_LABEL: Partial<Record<FilterId, Partial<Record<FilterKnob, string>>>> = {
  mosaic: { block: 'Block', levels: 'Levels', grain: 'Speckle' },
  tessera: { block: 'Tile' },
  diamond: { block: 'Tile' },
  halftone: { block: 'Pitch', angle: 'Angle', ink: 'Ink' },
  bayerMono: { block: 'Cell', matrix: 'Matrix' },
  bayerColor: { block: 'Cell', matrix: 'Matrix' },
}

/** Unit written after a knob's number (the two enums carry none). */
const KNOB_UNIT: Partial<Record<FilterKnob, string>> = { block: 'px', angle: '°' }

/** Swatch edge in CSS px. The cache draws it 1:1, so this is also the loupe's window in bitmap pixels. */
const SWATCH = 72

const tileCls = 'group/sw flex cursor-pointer flex-col items-center gap-1 rounded-none border border-transparent bg-transparent p-0.5 text-[10.5px] leading-tight text-dim outline-0 transition-[color,border-color] duration-(--dur-fast) hover:text-txt focus-visible:border-accent aria-pressed:border-accent aria-pressed:text-txt disabled:cursor-default disabled:opacity-40'

/** The focused pane, or null (no focus, or the grid route's empty id). */
function focusedLeaf(s: Parameters<typeof activeWs>[0]) {
  return findLeaf(activeWs(s).root, activeWs(s).focusId)
}

/**
 * One swatch bitmap. The cache does the work (square crop, filter, scale) and
 * hands back an object URL; a tile that is still rendering keeps the previous
 * texture-less plane, so opening the palette never flashes white holes.
 */
function Swatch({ photo, filter }: { photo: Photo, filter: FilterValue | null }) {
  const key = filterKey(filter)
  const filterRef = useRef(filter)
  const [url, setUrl] = useState<string | null>(() => peekFilterSwatch(photo.id, filter, SWATCH))
  // The setting's own key drives the render: `leaf.filter` is a fresh object on
  // every patch, and only a knob or an id change is a new bitmap.
  useEffect(() => {
    filterRef.current = filter
  }, [filter])
  useEffect(() => {
    let alive = true
    void getFilterSwatch(photo, filterRef.current, SWATCH).then((u) => {
      if (alive && u)
        setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [photo, key])
  return url
    ? <img src={url} alt="" draggable={false} className="block h-full w-full object-cover" />
    : <div className="h-full w-full animate-pulse bg-panel-2" />
}

/** The compact two-button pair the enum knobs (ink mode, matrix size) use. */
function ParamToggle({ label, options, value, onChange }: {
  label: string
  options: { value: number, text: string }[]
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-dim">{label}</span>
      <div className="flex gap-1">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            className="h-6 flex-1 cursor-pointer rounded-none border border-line-strong bg-transparent text-[11px] text-dim outline-0 hover:text-txt focus-visible:border-accent aria-pressed:border-accent aria-pressed:bg-panel-2 aria-pressed:text-txt"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The parameter strip: one row per knob the active filter takes, in stage
 * pixels / degrees / steps. Every change rewrites the pane's filter value, so it
 * rides the same undo stack and the same export path as a filter pick.
 */
function ParamStrip({ spec, onChange }: { spec: FilterSpec, onChange: (knob: FilterKnob, value: number) => void }) {
  const t = useT()
  const defs = FILTER_PARAMS[spec.id]
  if (!defs.length)
    return null
  const label = (knob: FilterKnob) => t(KNOB_LABEL[spec.id]?.[knob] ?? knob)
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2" data-filter-strip={spec.id}>
      {defs.map((d) => {
        const value = spec[d.knob] ?? d.def
        if (d.knob === 'ink') {
          return (
            <ParamToggle
              key={d.knob}
              label={label(d.knob)}
              value={value}
              onChange={v => onChange(d.knob, v)}
              options={[{ value: 0, text: t('Mono ink') }, { value: 1, text: t('Duotone ink') }]}
            />
          )
        }
        if (d.knob === 'matrix') {
          return (
            <ParamToggle
              key={d.knob}
              label={label(d.knob)}
              value={value}
              onChange={v => onChange(d.knob, v)}
              options={[{ value: 4, text: '4×4' }, { value: 8, text: '8×8' }]}
            />
          )
        }
        return (
          <div key={d.knob} className="grid grid-cols-[64px_minmax(0,1fr)_34px] items-center gap-2" data-filter-param={d.knob}>
            <span className="truncate text-[11px] text-dim">{label(d.knob)}</span>
            <div className="h-6">
              <AppSlider
                dense
                value={value}
                min={d.min}
                max={d.max}
                step={d.step}
                label={label(d.knob)}
                onChange={v => onChange(d.knob, v)}
              />
            </div>
            <span className="text-right text-[11px] tabular-nums text-accent">
              {value}
              {KNOB_UNIT[d.knob] ?? ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function PaneFilterTool({ hidden = false }: { hidden?: boolean }) {
  const t = useT()
  const paneId = useStore(s => activeWs(s).focusId)
  const photoId = useStore(s => focusedLeaf(s)?.photoId ?? null)
  const filter = useStore(s => focusedLeaf(s)?.filter)
  const photo = useStore(s => (photoId ? s.photos.find(p => p.id === photoId) ?? null : null))
  const setPaneFilter = useStore(s => s.setPaneFilter)
  const [open, setOpen] = useState(false)

  // Same rule as the pane tools: no focused pane holding a photo, no tool.
  if (hidden || !photoId || !photo)
    return null

  const spec = resolveFilter(filter)
  const pick = (id: FilterId | null) => setPaneFilter(paneId, id ? defaultFilter(id) : null)
  const setKnob = (knob: FilterKnob, value: number) => {
    if (!spec)
      return
    // Tagged: a slider drag is one undo step, not forty (see `setPaneFilter`).
    setPaneFilter(paneId, { ...spec, [knob]: value }, `filterParam:${paneId}:${knob}`)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`${toolsBtnCls} ${dockBtnStateCls}`}
        title={t('Texture the photo')}
        aria-label={t('Texture the photo')}
        data-dock-tool={t('Filter')}
        data-dock-filter=""
      >
        {/* `Blend`, not a brush or a wand: the wand is the cutout tool's glyph
         * and a brush reads as "draw". Two layered shapes say "texture over
         * the photo" and tell apart from every other dock tool at 22px. */}
        <MorphIcon icon={Blend} size={22} strokeWidth={1.5} />
        <span className={toolsLabelCls}>{t('Filter')}</span>
      </Popover.Trigger>
      <Popover.Portal>
        {/*
         * `sticky` for the same reason as the rotation tool: the trigger ends
         * the dock's scrolling row, and the re-measure on open clamps that
         * row's scroll, so the anchor has to be shifted back into view.
         */}
        <Popover.Positioner side="top" align="center" sideOffset={6} collisionPadding={8} sticky className="z-[260] select-none outline-0">
          {/* Scrolls inside its cap: the grid grew to fourteen tiles plus the
           * parameter strip, and a short window must still reach the last one. */}
          <Popover.Popup className={`${menuSurfaceCls} ${dockPopupMotionCls} max-h-[min(72dvh,560px)] w-[326px] overflow-y-auto p-2 text-txt`}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-dim">{t('Texture')}</span>
              <button
                type="button"
                className="flex h-6 cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent px-1.5 text-[11px] text-dim outline-0 hover:text-txt focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35"
                disabled={!filter}
                title={t('Clear filter')}
                aria-label={t('Clear filter')}
                onClick={() => pick(null)}
              >
                <MorphIcon icon={X} size={12} strokeWidth={2} />
                {t('Clear filter')}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                className={tileCls}
                aria-pressed={!filter}
                data-filter-id="none"
                title={t('None')}
                onClick={() => pick(null)}
              >
                <span className="block overflow-hidden rounded-none border border-line-strong" style={{ width: SWATCH, height: SWATCH }}>
                  <Swatch photo={photo} filter={null} />
                </span>
                <span className="max-w-full truncate">{t('None')}</span>
              </button>
              {FILTER_IDS.map((id) => {
                // The active tile shows the live setting; the others their
                // defaults, so the palette is one glance per filter.
                const active = spec?.id === id
                const value: FilterValue = active && filter ? filter : defaultFilter(id)
                return (
                  <button
                    key={id}
                    type="button"
                    className={tileCls}
                    aria-pressed={active}
                    data-filter-id={id}
                    title={t(FILTER_LABEL[id])}
                    onClick={() => pick(id)}
                  >
                    <span className="block overflow-hidden rounded-none border border-line-strong" style={{ width: SWATCH, height: SWATCH }}>
                      <Swatch photo={photo} filter={value} />
                    </span>
                    <span className="max-w-full truncate">{t(FILTER_LABEL[id])}</span>
                  </button>
                )
              })}
            </div>
            {spec && <ParamStrip spec={spec} onChange={setKnob} />}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
