/**
 * Self-check for seam detection and feather clamping: run with `bun
 * scripts/check-seams.ts`. Exit code 0 = all assertions held.
 */
import type { Leaf, Node, Rect, Split } from '../src/lib/panes'
import { layoutTree, leafCornerRadii, seamFadeWidth, seamSides } from '../src/lib/panes'

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

// 7. Gap 0 + radius: square corners on photo-photo seams only.
{
  const root = split('row', leaf('a'), leaf('b'))
  const { leaves, seams } = seamsOf(root, 0)
  const a = seams.get(leaves.find(l => l.node.photoId === 'a')!.node.id)!
  const b = seams.get(leaves.find(l => l.node.photoId === 'b')!.node.id)!
  const ra = leafCornerRadii(40, a, 0)
  const rb = leafCornerRadii(40, b, 0)
  if (ra.join(',') !== '40,0,0,40')
    throw new Error(`gap0 a corners: expected 40,0,0,40 got ${ra.join(',')}`)
  if (rb.join(',') !== '0,40,40,0')
    throw new Error(`gap0 b corners: expected 0,40,40,0 got ${rb.join(',')}`)
}

// 8. Gap > 0 keeps uniform radius (intentional gutters).
{
  const root = split('row', leaf('a'), leaf('b'))
  const { leaves, seams } = seamsOf(root, 30)
  const a = seams.get(leaves.find(l => l.node.photoId === 'a')!.node.id)!
  const ra = leafCornerRadii(40, a, 30)
  if (ra.join(',') !== '40,40,40,40')
    throw new Error(`gap>0 corners: expected uniform 40 got ${ra.join(',')}`)
}

// 9. 2x2 gap 0: center-facing corners square, outer corners keep radius.
{
  const root = split('column', split('row', leaf('a'), leaf('b')), split('row', leaf('c'), leaf('d')))
  const { leaves, seams } = seamsOf(root, 0)
  const id = (p: string) => leaves.find(l => l.node.photoId === p)!.node.id
  const expect: Record<string, string> = {
    a: '40,0,0,0',
    b: '0,40,0,0',
    c: '0,0,0,40',
    d: '0,0,40,0',
  }
  for (const [p, want] of Object.entries(expect)) {
    const got = leafCornerRadii(40, seams.get(id(p))!, 0).join(',')
    if (got !== want)
      throw new Error(`2x2 ${p}: expected ${want} got ${got}`)
  }
}

// 10. Integer-snap: odd W + ratio 0.5 → flush abut with integer edges (gap=0).
{
  const root = split('row', leaf('a'), leaf('b'))
  const W = 1001
  const { leaves } = layoutTree(root, W, 800, 0)
  const a = leaves.find(l => l.node.photoId === 'a')!.rect
  const b = leaves.find(l => l.node.photoId === 'b')!.rect
  if (a.x + a.w !== b.x)
    throw new Error(`odd-W abut: a.x+a.w=${a.x + a.w} b.x=${b.x}`)
  if (!Number.isInteger(a.x) || !Number.isInteger(a.w) || !Number.isInteger(b.x) || !Number.isInteger(b.w))
    throw new Error(`odd-W integers: a=${JSON.stringify(a)} b=${JSON.stringify(b)}`)
  if (a.w + b.w !== W)
    throw new Error(`odd-W sum: ${a.w}+${b.w} !== ${W}`)
}

// 11. ratio 1/3 on W=1000 → integer edges, exact cover.
{
  const root = split('row', leaf('a'), leaf('b'), 1 / 3)
  const W = 1000
  const { leaves } = layoutTree(root, W, 800, 0)
  const a = leaves.find(l => l.node.photoId === 'a')!.rect
  const b = leaves.find(l => l.node.photoId === 'b')!.rect
  if (a.x + a.w !== b.x)
    throw new Error(`1/3 abut: a.x+a.w=${a.x + a.w} b.x=${b.x}`)
  if (!Number.isInteger(a.w) || !Number.isInteger(b.w))
    throw new Error(`1/3 integers: aw=${a.w} bw=${b.w}`)
  if (a.w + b.w !== W)
    throw new Error(`1/3 sum: ${a.w}+${b.w} !== ${W}`)
  // Math.round(1000/3) = 333
  if (a.w !== 333)
    throw new Error(`1/3 aw: expected 333 got ${a.w}`)
}

// 12. gap>0 still sums: a.w + gap + b.w === outer content width.
{
  const root = split('row', leaf('a'), leaf('b'))
  const W = 1000
  const gap = 20
  const { leaves } = layoutTree(root, W, 800, gap)
  const a = leaves.find(l => l.node.photoId === 'a')!.rect
  const b = leaves.find(l => l.node.photoId === 'b')!.rect
  const content = W - gap * 2
  if (a.w + gap + b.w !== content)
    throw new Error(`gap sum: ${a.w}+${gap}+${b.w} !== ${content}`)
  if (a.x + a.w + gap !== b.x)
    throw new Error(`gap abut spacing: ${a.x + a.w}+${gap} !== ${b.x}`)
  if (!Number.isInteger(a.w) || !Number.isInteger(b.w))
    throw new Error(`gap integers: aw=${a.w} bw=${b.w}`)
}

// 13. Column split + nested 2x2 stay integer-flush at gap=0.
{
  const root = split('column', split('row', leaf('a'), leaf('b')), split('row', leaf('c'), leaf('d')))
  const W = 801
  const H = 601
  const { leaves } = layoutTree(root, W, H, 0)
  for (const { rect } of leaves) {
    if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y) || !Number.isInteger(rect.w) || !Number.isInteger(rect.h))
      throw new Error(`2x2 odd integer rect: ${JSON.stringify(rect)}`)
  }
  const by = (p: string) => leaves.find(l => l.node.photoId === p)!.rect
  if (by('a').x + by('a').w !== by('b').x)
    throw new Error('2x2 top row abut')
  if (by('a').y + by('a').h !== by('c').y)
    throw new Error('2x2 left col abut')
}

console.log('check-seams: OK (incl. pixel-snap)')
