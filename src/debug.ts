import * as exporter from './lib/exporter'
import * as imageStore from './lib/imageStore'
import * as panes from './lib/panes'
import { useStore } from './store'

export function installDebugHandle() {
  ;(globalThis as unknown as Record<string, unknown>).__collage = {
    useStore,
    store: () => useStore.getState(),
    imageStore,
    exporter,
    panes,
  }
}
