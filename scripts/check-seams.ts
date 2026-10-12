/**
 * Self-check for seam detection and feather clamping: run with `bun
 * scripts/check-seams.ts`. Exit code 0 = all assertions held.
 */
import type { Leaf, Node, Rect, Split } from '../src/lib/panes'
import { layoutTree, seamFadeWidth, seamSides } from '../src/lib/panes'

let seq = 0
function leaf(photo: string | null): Leaf {
  return {
    type: 'leaf',
    id: photo ?? `e${++seq}`,
    photoId: photo,
    zoom: 1,
    cx: 0.5,
    cy: 0.5,
    stickers: [],
    label: null,
  }
}

function split(dir: 'row' | 'column', a: Node, b: Node, ratio = 0.5): Split {
  return { type: 'split', id: `s${++seq}`, dir, ratio, a, b }
}

function seamsOf(root: Node, gap: number) {
  const { leaves } = layoutTree(root, 1000, 1000, gap)
  return { leaves, seams: seamSides(leaves, gap) }
}

function sidesOf(root: Node, photo: string, gap = 0) {
  const { leaves, seams } = seamsOf(root, gap)
  const id = leaves.find(l => l.node.photoId === photo)?.node.id
  if (!id)
    throw new Error(`no leaf with photo ${photo}`)
  return seams.get(id)!
}

function eq(actual: string, expected: string, what: string) {
  if (actual !== expected)
    throw new Error(`${what}: expected [${expected}] got [${actual}]`)
}

function flag(s: { left: boolean, right: boolean, top: boolean, bottom: boolean }) {
  return ['left', 'right', 'top', 'bottom'].filter(k => s[k as keyof typeof s]).join(',')
}

// 1. Two panes side by side, both filled: seam runs between them only.
{
  const root = split('row', leaf('a'), leaf('b'))
  eq(flag(sidesOf(root, 'a')), 'right', 'a|b a')
  eq(flag(sidesOf(root, 'b')), 'left', 'a|b b')
}

// 2. Neighbor empty: no feather against it.
{
  const root = split('row', leaf('a'), leaf(null))
  eq(flag(sidesOf(root, 'a')), '', 'a|empty')
}

// 3. 2×2: inner edges only, outer canvas border stays hard.
{
  const root = split('column', split('row', leaf('a'), leaf('b')), split('row', leaf('c'), leaf('d')))
  eq(flag(sidesOf(root, 'a')), 'right,bottom', '2x2 a')
  eq(flag(sidesOf(root, 'b')), 'left,bottom', '2x2 b')
  eq(flag(sidesOf(root, 'c')), 'right,top', '2x2 c')
  eq(flag(sidesOf(root, 'd')), 'left,top', '2x2 d')
}

// 4. Same tree with a gap: adjacency still resolves across the gap.
{
  const root = split('row', leaf('a'), leaf('b'))
  eq(flag(sidesOf(root, 'a', 30)), 'right', 'gap a')
  eq(flag(sidesOf(root, 'b', 30)), 'left', 'gap b')
}

// 5. Tall pane beside a stack: both stacked leaves see the tall one.
{
  const root = split('row', leaf('a'), split('column', leaf('b'), leaf('c')))
  eq(flag(sidesOf(root, 'a')), 'right', 'tall a')
  eq(flag(sidesOf(root, 'b')), 'left,bottom', 'tall b')
  eq(flag(sidesOf(root, 'c')), 'left,top', 'tall c')
}

// 6. Feather width clamps to half the pane's short side.
{
  const rect: Rect = { x: 0, y: 0, w: 100, h: 50 }
  if (seamFadeWidth(60, rect) !== 25)
    throw new Error(`clamp: expected 25 got ${seamFadeWidth(60, rect)}`)
  if (seamFadeWidth(10, rect) !== 10)
    throw new Error(`clamp passthrough: expected 10 got ${seamFadeWidth(10, rect)}`)
  if (seamFadeWidth(-1, rect) !== 0)
    throw new Error('clamp must floor at 0')
}

console.log('check-seams: OK')
