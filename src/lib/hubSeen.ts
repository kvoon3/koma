/**
 * The three destinations remember when each was last opened, so the retained
 * launcher (`#/legacy-index`) can say "last opened 19:15" instead of listing
 * bare links. It is localStorage state of its own (`collage:hubSeen`), beside
 * the persisted settings, not session state: losing it costs a timestamp and
 * nothing else, and with the launcher off the main flow nothing else reads it.
 *
 * The mapping (which route belongs to which destination) and the label
 * formatting are pure, so they are unit-tested without a browser.
 */

/** The hub's three destinations, in the order the launcher shows them. */
export type HubKey = 'grid' | 'photos' | 'stickers'

const KEY = 'collage:hubSeen'

/**
 * The destination a route belongs to: the board overview and the editor are
 * grid making (a board is where the grid is edited), and the two library pages
 * are their own entries. `#/legacy-index` belongs to nothing: opening the
 * retained launcher is not a visit to a destination.
 */
export function hubKeyForPath(path: string): HubKey | null {
  if (path === '/' || path === '/w/$wsId' || path.startsWith('/w/'))
    return 'grid'
  if (path === '/photos')
    return 'photos'
  if (path === '/stickers')
    return 'stickers'
  return null
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  }
  catch {
    return null
  }
}

/** When each destination was last opened (ms since the epoch); missing = never. */
export function readHubSeen(): Partial<Record<HubKey, number>> {
  const ls = store()
  if (!ls)
    return {}
  try {
    const raw = ls.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object')
      return {}
    const out: Partial<Record<HubKey, number>> = {}
    for (const key of ['grid', 'photos', 'stickers'] as const) {
      const value = (parsed as Record<string, unknown>)[key]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0)
        out[key] = value
    }
    return out
  }
  catch {
    return {}
  }
}

/** Record that a destination was just opened. */
export function markHubSeen(key: HubKey, now: number = Date.now()): void {
  const ls = store()
  if (!ls)
    return
  try {
    ls.setItem(KEY, JSON.stringify({ ...readHubSeen(), [key]: now }))
  }
  catch {
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * A visit as the card's small print shows it: `19:15` for today, `10-18 19:15`
 * for an earlier day. Null when the destination was never opened, which is
 * what "nothing to say here" means on a fresh install.
 */
export function formatSeen(seen: number | undefined, now: number = Date.now()): string | null {
  if (!seen || !Number.isFinite(seen) || seen <= 0)
    return null
  const then = new Date(seen)
  const today = new Date(now)
  const time = `${pad2(then.getHours())}:${pad2(then.getMinutes())}`
  const sameDay = then.getFullYear() === today.getFullYear()
    && then.getMonth() === today.getMonth()
    && then.getDate() === today.getDate()
  if (sameDay)
    return time
  return `${pad2(then.getMonth() + 1)}-${pad2(then.getDate())} ${time}`
}
