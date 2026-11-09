/**
 * The sticker maker's dialog shell: which tab is showing, which door fills the
 * stage slot, and whether a bake is being written.
 *
 * The slots are one panel at a time by construction. Before this module the
 * dialog kept the panel in a `useState` keyed by an open/tab string, and the
 * save button only excluded the camera panel, so Cancel/Apply of the mask
 * editor and the library picker sat beside a live Insert that saved the
 * pre-edit image. Here opening any door closes save, and only the bare stage
 * can bake.
 */
export type MakerTab = 'text' | 'image'
export type MakerPanel = 'stage' | 'camera' | 'library' | 'mask'

export interface StickerMakerFlow {
  tab: MakerTab
  panel: MakerPanel
  saving: boolean
}

export type StickerMakerEvent
  = | { type: 'tab', tab: MakerTab }
    | { type: 'panel', panel: Exclude<MakerPanel, 'stage'> }
    | { type: 'stage' }
    | { type: 'save-start' }
    | { type: 'save-settle' }
    | { type: 'close' }

export function initialStickerMaker(tab: MakerTab): StickerMakerFlow {
  return { tab, panel: 'stage', saving: false }
}

function switchTab(state: StickerMakerFlow, tab: MakerTab): StickerMakerFlow {
  // The panels are doors into the image source, so a tab change closes
  // whichever one was open instead of carrying it onto the text tab.
  return state.tab === tab ? state : { ...state, tab, panel: 'stage' }
}

function openPanel(state: StickerMakerFlow, panel: Exclude<MakerPanel, 'stage'>): StickerMakerFlow {
  // A panel opens from the stage only: one door at a time.
  return state.tab === 'image' && state.panel === 'stage' ? { ...state, panel } : state
}

function closePanel(state: StickerMakerFlow): StickerMakerFlow {
  return state.panel === 'stage' ? state : { ...state, panel: 'stage' }
}

function startSave(state: StickerMakerFlow): StickerMakerFlow {
  // The component has already checked the subject, target and cutout; the
  // shell's own rule is that only the bare stage may bake.
  return state.panel === 'stage' && !state.saving ? { ...state, saving: true } : state
}

function settleSave(state: StickerMakerFlow): StickerMakerFlow {
  return state.saving ? { ...state, saving: false } : state
}

function closeMaker(state: StickerMakerFlow): StickerMakerFlow {
  return state.panel === 'stage' && !state.saving ? state : { ...state, panel: 'stage', saving: false }
}

export function stickerMakerTransition(state: StickerMakerFlow, event: StickerMakerEvent): StickerMakerFlow {
  switch (event.type) {
    case 'tab':
      return switchTab(state, event.tab)
    case 'panel':
      return openPanel(state, event.panel)
    case 'stage':
      return closePanel(state)
    case 'save-start':
      return startSave(state)
    case 'save-settle':
      return settleSave(state)
    case 'close':
      return closeMaker(state)
  }
}

export type StickerImageStage = 'empty' | 'cuttingOut' | 'ready'

/** What the stage slot holds: the empty pick door, the cutout veil, or the live sticker. */
export function makerImageStage(hasImage: boolean, cutting: boolean): StickerImageStage {
  if (!hasImage)
    return 'empty'
  return cutting ? 'cuttingOut' : 'ready'
}

/**
 * A bake needs a subject, a board or folder to land in, and the bare stage:
 * no camera/library/mask door over it, no cutout running, no save in flight.
 */
export function canSaveSticker(input: {
  flow: StickerMakerFlow
  hasSource: boolean
  hasTarget: boolean
  cutting: boolean
}): boolean {
  const { flow, hasSource, hasTarget, cutting } = input
  return hasSource && hasTarget && !flow.saving && !cutting && flow.panel === 'stage'
}
