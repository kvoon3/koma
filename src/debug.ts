import * as exporter from './lib/exporter'
import * as imageStore from './lib/imageStore'
import * as panes from './lib/panes'
import * as regeo from './lib/regeo'
import * as sticker from './lib/sticker'
import { useStore } from './store'

export function installDebugHandle() {
  const g = globalThis as typeof globalThis & { __collage?: Record<string, unknown> }
  g.__collage = {
    useStore,
    store: () => useStore.getState(),
    imageStore,
    exporter,
    panes,
    regeo,
    sticker,
  }
}
