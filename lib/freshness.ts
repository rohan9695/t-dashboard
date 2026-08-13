// lib/freshness.ts
// How old is too old — the one definition, used by the per-account dots, the
// "NinjaTrader offline" banner, and anything else that judges freshness.
//
// It depends entirely on whether money is at risk right now.
//
// FLAT: NT8 genuinely has nothing to say between trades, and the addon drops to
// a 30s flush outside the 9-1 window. Ten minutes of silence is normal, and
// flagging it would be noise on a display that is meant to be glanceable.
//
// IN A POSITION: ten minutes is dangerous. MNQ moves $2 a point, so a
// four-minute-old figure was $86 wrong on a single contract — and it rendered
// green, with the dashboard vouching for a number the market had already left
// behind. In-window the addon flushes every 3s, so 20s is several missed
// batches, not jitter.
//
// Trade-off: holding a position OUTSIDE the 9-1 window means a 30s flush, so
// the dot will sit amber for much of it. That is not a false alarm — the figure
// really is up to 30s old — and while a position is open, saying so is the job.
//
// Kept in its own module rather than in a component so the tests can import it
// directly (node strips types from .ts, but cannot parse .tsx), and out of
// trading-logic.ts because that file is byte-mirrored to the Deno edge
// functions, which have no use for display thresholds.

export const STALE_FLAT_MS       = 10 * 60_000
export const STALE_IN_TRADE_MS   = 20_000
export const OFFLINE_FLAT_MS     = 30 * 60_000
export const OFFLINE_IN_TRADE_MS = 90_000

/** Whatever carries open-position P&L. Both fields are kept in sync by
 *  batch-update, but a row read straight from the database may have only one. */
export interface FreshnessRow {
  dollar_open?: number | null
  unrealized_pnl?: number | null
}

/** True when the account is carrying an open position. */
export function inTrade(row: FreshnessRow): boolean {
  return (row.dollar_open ?? 0) !== 0 || (row.unrealized_pnl ?? 0) !== 0
}

/** Age at which a row stops counting as live (amber). */
export function staleThresholdMs(row: FreshnessRow): number {
  return inTrade(row) ? STALE_IN_TRADE_MS : STALE_FLAT_MS
}

/** Age at which a row counts as gone (grey), and the offline banner fires. */
export function offlineThresholdMs(row: FreshnessRow): number {
  return inTrade(row) ? OFFLINE_IN_TRADE_MS : OFFLINE_FLAT_MS
}
