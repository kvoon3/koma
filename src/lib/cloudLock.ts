/**
 * The next `updated_at` for a write, as a SQL expression. `datetime('now')`
 * has one-second resolution, so two writes inside one second leave the same
 * token and the second still matches the client's base. Taking the later of
 * the wall clock and the old value plus one millisecond makes every write
 * strictly greater than the token its WHERE matched, so every earlier base is
 * refused even when the writes land in the same millisecond.
 */
export const NEXT_UPDATED_AT_SQL
  = `max(strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', updated_at, '+0.001 seconds'))`
