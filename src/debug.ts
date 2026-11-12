import * as bgRemoval from './lib/bgRemoval'
import * as exporter from './lib/exporter'
import * as exportSession from './lib/exportSession'
import * as imageStore from './lib/imageStore'
import * as librarySelection from './lib/librarySelection'
import * as musicCard from './lib/musicCard'
import * as musicCardFlow from './lib/musicCardFlow'
import * as panes from './lib/panes'
import * as regeo from './lib/regeo'
import * as sticker from './lib/sticker'
import * as stickerMakerFlow from './lib/stickerMakerFlow'
import * as stickerRecipe from './lib/stickerRecipe'
import { useStore } from './store'

export function installDebugHandle() {
  window.__collage = {
    useStore,
    store: () => useStore.getState(),
    imageStore,
    exporter,
    musicCard,
    panes,
    regeo,
    sticker,
    stickerRecipe,
    bgRemoval,
    // The pure lifecycle machines, so an agent can read or drive a flow
    // without a browser (see docs/state-machines.md).
    flows: { exportSession, librarySelection, musicCardFlow, stickerMakerFlow },
  }
}
