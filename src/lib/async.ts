/**
 * Run `fn` over `items` strictly one at a time, in order, collecting the
 * results. Written as a promise chain rather than a `for` loop on purpose:
 * these iterations are order- and memory-dependent (full-resolution canvases,
 * one decode in flight), which is exactly when sequential execution must be
 * kept.
 */
export function mapSeq<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  return items.reduce<Promise<R[]>>(
    (chain, item, index) => chain.then(async (out) => {
      out.push(await fn(item, index))
      return out
    }),
    Promise.resolve([]),
  )
}
