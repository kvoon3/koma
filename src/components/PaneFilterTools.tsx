import type { FilterId, FilterKnob, FilterSpec, FilterValue } from '../lib/filters'
import type { Photo } from '../lib/imageStore'
import type { TKey } from '../lib/locales/zh-Hans'
import { Popover } from '@base-ui/react/popover'
import { Blend, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getFilterSwatch, peekFilterSwatch } from '../lib/filterCache'
import { defaultFilter, FILTER_IDS, FILTER_PARAMS, filterKey, resolveFilter } from '../lib/filters'
import { useT } from '../lib/i18n'
import { findLeaf } from '../lib/panes'
import { activeWs, useStore } from '../store'
import { useDockPopover } from './DockMarks'
import { toolsBtnCls, toolsLabelCls } from './ToolsDock'
import { AppSlider } from './ui/field'
import { dockBtnStateCls, dockPopupMotionCls, menuSurfaceCls } from './ui/menu'

/**
 * The drawer's texture tool: one button in the pane tools that opens a palette
 * of fifteen filters (see `lib/filters`), each swatch rendered from the
 * focused pane's own photo, plus None to clear. A sibling of the pane tools
 * rather than a member of their list, so the dock's order and the tools'
 * existing layout are untouched (Stage.tsx renders it once, like the rotation
 * dial next to it).
 *
 * The eight textures are frozen presets; the seven pixel filters (mosaic, tiles,
 * screens, the dithers) take parameters, and the strip under the grid dials
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
// @x18n-keys
const FILTER_LABEL: Record<FilterId, TKey> = {
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
  ditherDiffuse: 'Error Diffusion',
}

type KnobOf<Id extends FilterId> = (typeof FILTER_PARAMS)[Id][number]['knob']

/**
 * What each knob is called on each filter: the same dial is a block, a tile, a
 * dot pitch or a dither cell, and the label is what says so. Frozen textures
 * take none. The `satisfies` clause makes a filter's missing knob label a
 * compile error, so no lookup has to fall back to the raw id.
  * @x18n-keys
  */
const KNOB_LABEL = {
  grain: {},
  duotoneWarm: {},
  duotoneCool: {},
  duotoneSepia: {},
  print: {},
  cyanotype: {},
  paper: {},
  bitgrain: {},
  mosaic: { block: 'Block', levels: 'Levels', grain: 'Speckle' },
  tessera: { block: 'Tile' },
  diamond: { block: 'Tile' },
  halftone: { block: 'Pitch', angle: 'Angle', ink: 'Ink' },
  bayerMono: { block: 'Cell', matrix: 'Matrix' },
  bayerColor: { block: 'Cell', matrix: 'Matrix' },
  ditherDiffuse: { block: 'Cell' },
} as const satisfies { [Id in FilterId]: Record<KnobOf<Id>, TKey> }

function knobLabel(id: FilterId, knob: FilterKnob): TKey {
  const labels: Partial<Record<FilterKnob, TKey>> = KNOB_LABEL[id]
  const label = labels[knob]
  if (!label)
    throw new Error(`No label for filter knob ${id}.${knob}`)
  return label
}

/** Unit written after a knob's number (the two enums carry none). */
const KNOB_UNIT: Partial<Record<FilterKnob, string>> = { block: 'px', angle: '°' }

/** The window's size, as the one external value the popover's bounds depend on. */
const viewportKey = () => `${window.innerWidth}x${window.innerHeight}`
function subscribeViewport(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

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
  const label = (knob: FilterKnob) => t(knobLabel(spec.id, knob))
  return (
    <div className="mb-2 flex flex-col gap-1.5 border-b border-line pb-2" data-filter-strip={spec.id}>
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
  /** The gate that unmounts the trigger, stated once and handed to the hook. */
  const enabled = !hidden && !!photoId && !!photo
  // The open state lives in the dock's store below this gate (issue #76): a
  // stage press can deselect mid-dispatch, so the claim is released by the
  // trigger's own unmount and a remount cannot match it.
  const dock = useDockPopover(enabled, 'filter')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const viewport = useSyncExternalStore(subscribeViewport, viewportKey, () => '0x0')
  const { triggerRef: dockTriggerRef } = dock

  // The hook owns the trigger ref; this mirrors it for the bounds memo.
  const setTrigger = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el
    dockTriggerRef(el)
  }, [dockTriggerRef])

  /**
   * The dock is a bottom sheet overlaying the stage, so "above the trigger" is
   * not "above the dock": at a short window the palette's lower rows land under
   * the sheet's chrome. Anchor the popup above the sheet's top edge instead, and
   * cap its height to the room over that edge. Keyed on the open state, so a
   * hover hand-over measures like a click, and again whenever the window
   * resizes (the sheet only changes size when the dock's mode does, and that tap
   * closes the popover first).
   */
  const bounds = useMemo(() => {
    if (!dock.open)
      return null
    const trigger = triggerRef.current
    if (!trigger)
      return null
    const t = trigger.getBoundingClientRect()
    const sheet = trigger.closest('[data-dock-mode]')
    const sheetTop = sheet ? sheet.getBoundingClientRect().top : t.top
    // The container's height is the last resort, in case the sheet's own box is
    // mid-animation when it is read.
    const room = Number(viewport.split('x')[1]) || window.innerHeight
    return {
      offset: Math.max(6, Math.round(t.top - sheetTop) + 6),
      maxH: Math.max(180, Math.min(560, Math.round(sheetTop) - 16, room - 16)),
    }
  }, [dock.open, viewport])

  // Same rule as the pane tools: no focused pane holding a photo, no tool.
  if (!enabled)
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
    <Popover.Root open={dock.open} onOpenChange={dock.onOpenChange} {...dock.rootProps}>
      <Popover.Trigger
        ref={setTrigger}
        {...dock.triggerProps}
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
        <Popover.Positioner
          side="top"
          align="center"
          sideOffset={bounds?.offset ?? 6}
          collisionPadding={8}
          sticky
          className="z-[260] select-none outline-0"
        >
          {/* Capped to the room above the dock (`bounds`), with the strip and the
           * tiles in one scrolling body: a short window reaches every filter and
           * the last row still sits above the sheet, never behind it. */}
          <Popover.Popup
            className={`${menuSurfaceCls} ${dockPopupMotionCls} flex w-[326px] flex-col p-2 text-txt`}
            {...dock.popupProps}
            style={{ maxHeight: bounds?.maxH, ...dock.popupProps.style }}
          >
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
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-filter-body="">
              {spec && <ParamStrip spec={spec} onChange={setKnob} />}
              <div className="mt-2 grid grid-cols-4 gap-1.5">
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
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
