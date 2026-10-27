import type { Workspace } from '../store'
import type { TKey, Translate } from './i18n'
import type { LabelAlign, PaneLabel } from './panes'
import { t } from './i18n'
import { newLeaf, uid } from './panes'

/**
 * The share-card presets the grid's + cell offers next to a blank workspace.
 * A card is an ordinary workspace seeded with a canvas ratio and a few labels;
 * there is no card entity, and the editor, labels, fonts and export never know
 * the workspace started as a preset.
 */
export type CardKind = 'cover' | 'lyrics'

interface LabelSpec {
  text: TKey
  /** Canvas-normalized center, as every board label stores it. */
  x: number
  y: number
  /** Per-mille of the board's short edge (see `computeGeometry`). */
  size: number
  align: LabelAlign
}

interface CardPreset {
  /** Canvas width / height. */
  ratio: number
  labels: LabelSpec[]
}

/**
 * Cover text hugs the bottom left of a square; lyrics sit centered in a 4:5
 * portrait with a credit at the bottom. Sizes are per-mille of the short edge,
 * so they hold at both 1024 and 2048 long edge. The system font is deliberate:
 * a preset must export with no network, and a missing Google face would fall
 * back to it anyway.
  * @x18n-keys
  */
const PRESETS: Record<CardKind, CardPreset> = {
  cover: {
    ratio: 1,
    labels: [
      { text: 'Your title', x: 0.36, y: 0.78, size: 70, align: 'left' },
      { text: 'Your artist', x: 0.27, y: 0.89, size: 36, align: 'left' },
    ],
  },
  lyrics: {
    ratio: 0.8,
    labels: [
      { text: 'Your lyrics', x: 0.5, y: 0.44, size: 56, align: 'center' },
      { text: 'Your artist', x: 0.5, y: 0.93, size: 30, align: 'center' },
    ],
  },
}

function label(spec: LabelSpec, translate: Translate): PaneLabel {
  return {
    id: uid('l'),
    text: translate(spec.text),
    font: '',
    theme: 'dark',
    x: spec.x,
    y: spec.y,
    size: spec.size,
    rot: 0,
    align: spec.align,
  }
}

/**
 * A fresh workspace for one preset. Placeholder copy is translated here, at
 * creation: the store keeps document text, not keys, so switching language
 * later must not rewrite a card the user already edited.
 */
export function cardWorkspace(kind: CardKind, translate: Translate = t): Workspace {
  const preset = PRESETS[kind]
  const root = newLeaf()
  return {
    id: uid('w'),
    root,
    focusId: root.id,
    canvasRatio: preset.ratio,
    canvasFill: 1,
    stickers: [],
    labels: preset.labels.map(spec => label(spec, translate)),
  }
}
