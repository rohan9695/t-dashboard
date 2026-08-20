// supabase/functions/_shared/trading-logic.ts
// MIRROR COPY of lib/trading-logic.ts for the Supabase Edge Functions
// (they run on Deno and can't import from the Next.js lib/ tree).
// If you change lib/trading-logic.ts, copy it here again and re-deploy
// the batch-update / sync-accounts edge functions.

// ── ITEM MAP ────────────────────────────────────────────────────────────────
// NinjaTrader AccountItem names → dashboard field names
export const ITEM_MAP: Record<string, string> = {
  // Existing NT8 items
  NetLiquidation:            'total_available',
  TotalAvailable:            'total_available',
  CashValue:                 'total_available',
  DollarOpen:                'dollar_open',
  OpenPnL:                   'dollar_open',
  UnrealizedProfitLoss:      'unrealized_pnl',
  DistToDailyLoss:           'dist_to_daily_loss',
  DailyLossRemaining:        'dist_to_daily_loss',
  DistanceToDailyLoss:       'dist_to_daily_loss',
  DrawdownAuto:              'drawdown_auto',
  DrawDownAuto:              'drawdown_auto',
  TrailingMax:               'trailing_max',
  TrailingThreshold:         'trailing_max',
  DistDrawdown:              'dist_drawdown',
  DistanceToDrawdown:        'dist_drawdown',
  RealizedProfitLoss:        'realized_pnl',
  // Pre-commission, so it must never beat the net RealizedProfitLoss that
  // usually follows it — ITEM_PRIORITY below enforces that regardless of the
  // order they arrive in. It was previously left unmapped altogether, which
  // predates ITEM_PRIORITY and was the only defence available at the time. The
  // cost of dropping it: on a connection that sends ONLY the gross figure,
  // realized_pnl never enters nt_fields, so the daily rollover zeroes it and
  // REALIZED reads $0.00 for the rest of the session no matter how much was
  // made. A gross number is a little optimistic; zero is simply wrong.
  GrossRealizedProfitLoss:   'realized_pnl',
  // Task 6: new Tradovate fields from NT8 addon
  TrailingDrawdownValue:     'tradovate_trailing_drawdown',
  RealizedPnL:               'tradovate_realized_pnl',
  UnrealizedPnL:             'tradovate_unrealized_pnl',
  ExcessIntradayMargin:      'tradovate_margin_used',
  DailyPnL:                  'tradovate_daily_pnl',
}

// ── ITEM PRIORITY ───────────────────────────────────────────────────────────
// Several NT8 items map to the same dashboard field but do NOT mean the same
// thing. A single batch can carry more than one of them, and plain
// last-key-wins iteration would let the weakest source overwrite the best one.
//
// total_available is meant to be account equity. NetLiquidation includes the
// P&L of open positions; CashValue does not move at all while a position is
// open. Letting CashValue land last pins equity to a flat number mid-trade,
// and because dist_drawdown / dist_to_daily_loss are both derived from
// total_available, the entire risk display freezes with it.
//
// Higher number wins. Items absent from this map are priority 0, so fields
// with only one source keep their previous last-wins behaviour.
export const ITEM_PRIORITY: Record<string, number> = {
  NetLiquidation: 3,
  TotalAvailable: 2,
  CashValue:      1,
  // realized_pnl: net beats gross. Gross is pre-commission, so it is only ever
  // a stand-in for a connection that does not send the net figure at all.
  RealizedProfitLoss:      2,
  GrossRealizedProfitLoss: 1,
}

// ── ACCOUNT SIZE PROFILES ────────────────────────────────────────────────────
// (min_balance, starting, trailing_max, daily_loss_limit, safety_net_floor)
const ACCOUNT_SIZE_PROFILES: [number, number, number, number, number][] = [
  [140000, 150000, 4000, 1500, 150100],
  [ 90000, 100000, 3000, 1200, 100100],
  [ 45000,  50000, 2000, 1000,  50100],
  [ 20000,  25000, 1000,  500,  25100],
]

// PAAPEX and LFE 50K accounts have a $2,500 trailing drawdown (not $2,000)
const PAAPEX_LFE_PROFILES: [number, number, number, number, number][] = [
  [140000, 150000, 4000, 1500, 150100],
  [ 90000, 100000, 3000, 1200, 100100],
  [ 45000,  50000, 2500, 1000,  50100],
  [ 20000,  25000, 1500,  500,  25100],
]

// Falling off the end of the table means the balance is BELOW the smallest
// bucket's floor (20,000) — an account that has drawn down hard, not a big one.
// This used to return a 50K profile, which is the opposite reading: a 25K
// account at 19,999 was relabelled 50K, its trailing allowance doubled from
// 1,000 to 2,000, and its safety_net_floor jumped 25,100 -> 50,100, which
// removes the cap on the threshold entirely. A drawdown is exactly when the
// risk numbers must not start describing a different account, so the smallest
// profile in the relevant table is used instead.
const smallestProfile = (
  profiles: [number, number, number, number, number][],
): AccountProfile => {
  const [, start, trail, dll, safety] = profiles[profiles.length - 1]
  return {
    starting_balance: start,
    trailing_max:     trail,
    daily_loss_limit: dll,
    safety_net_floor: safety,
  }
}

export interface AccountProfile {
  starting_balance:  number
  trailing_max:      number
  daily_loss_limit:  number
  safety_net_floor:  number
}

export function detectAccountProfile(balance: number, accountId = ''): AccountProfile {
  const id = accountId.toUpperCase()
  const profiles =
    (id.startsWith('PAAPEX') || id.startsWith('LFE'))
      ? PAAPEX_LFE_PROFILES
      : ACCOUNT_SIZE_PROFILES

  for (const [minBal, start, trail, dll, safety] of profiles) {
    if (balance >= minBal) {
      return {
        starting_balance:  start,
        trailing_max:      trail,
        daily_loss_limit:  dll,
        safety_net_floor:  safety,
      }
    }
  }
  return smallestProfile(profiles)
}

// ── EMPTY ACCOUNT ────────────────────────────────────────────────────────────
export function emptyAccount(): AccountRow {
  return {
    account_id:                 '',
    dollar_open:                0,
    dist_to_daily_loss:         0,
    drawdown_auto:              0,
    total_available:            0,
    trailing_max:               0,
    dist_drawdown:              0,
    unrealized_pnl:             0,
    realized_pnl:               0,
    net_liq:                    0,
    peak_balance:               0,
    day_start_balance:          0,
    day_date:                   '',
    source:                     'ninjatrader',
    nt_fields:                  [],
    last_update:                new Date().toISOString(),
    status:                     'active',
    tradovate_trailing_drawdown: null,
    tradovate_realized_pnl:     null,
    tradovate_unrealized_pnl:   null,
    tradovate_margin_used:      null,
    tradovate_daily_pnl:        null,
    tradovate_synced_at:        null,
    hidden:                     false,
    last_batch_ts:              0,
  }
}

export interface AccountRow {
  account_id:         string
  dollar_open:        number
  dist_to_daily_loss: number
  drawdown_auto:      number
  total_available:    number
  trailing_max:       number
  dist_drawdown:      number
  unrealized_pnl:     number
  realized_pnl:       number
  net_liq:            number
  peak_balance:       number
  day_start_balance:  number
  day_date:           string
  source:             string
  nt_fields:          string[]
  last_update:        string
  status:             string
  // Task 6: Tradovate live fields (optional — only present when NT8 sends them)
  tradovate_trailing_drawdown?: number | null
  tradovate_realized_pnl?:      number | null
  tradovate_unrealized_pnl?:    number | null
  tradovate_margin_used?:       number | null
  tradovate_daily_pnl?:         number | null
  tradovate_synced_at?:         string | null
  replikanto_role?:              'leader' | 'follower' | null
  // Replikanto's own link state, read by the NT8 addon via reflection and
  // broadcast with every batch as "_replikanto" (same value on every account
  // row in a batch — it's a single link, not per-account). 'online' | 'off' |
  // 'away' | 'unknown'. Never a confident wrong answer — every reflection
  // failure path on the addon side lands on 'unknown'. See CLAUDE.md
  // "Replikanto: readable, but only through a private singleton".
  replikanto_status?:            string | null
  // true when NT8 no longer reports this account — hidden from the dashboard,
  // never auto-deleted (see /api/sync-accounts)
  hidden?:                       boolean
  // Send-time (ms since epoch) of the last batch that was actually applied —
  // guards against an older batch clobbering newer data when multiple hosts
  // write the same row concurrently (see /api/batch-update)
  last_batch_ts?:                number
}

// ── COMPUTE TRADOVATE METRICS ────────────────────────────────────────────────
// NT8 is the source of truth. Any risk field NT8 reports directly is shown
// exactly as the platform shows it — the dashboard must not disagree with the
// number on the trading screen.
//
// Everything below is a FALLBACK, applied only to fields NT8 never sent, so an
// account whose addon reports just equity still gets a usable risk readout
// instead of zeros. Which fields NT8 owns is tracked in row.nt_fields.
//
// This deliberately reverses the previous behaviour, where these values were
// always recomputed from a balance-guessed account profile and NT8's own
// numbers were discarded. That guessing could disagree with the platform in
// both directions, including showing a healthy buffer on an account that was
// actually in trouble. Trade-off accepted when this changed: NT8 has been seen
// reporting 0 for these fields while equity was clearly non-zero, and such a 0
// will now display as a zero buffer (reads as a breach). A visible false alarm
// that clears on the next update beats silently masking a real breach.
//
// onlyMissing only controls dollar_open (NT8 may send it directly).
export function computeTradovateMetrics(
  row: AccountRow,
  onlyMissing = true,
  freshFields?: Set<string>,
): void {
  const avail = row.total_available || 0
  if (avail <= 0) return

  // Fields NT8 has reported directly — never recomputed below.
  const nt = new Set(row.nt_fields || [])

  const p = detectAccountProfile(avail, row.account_id)
  const trail    = p.trailing_max
  const safety   = p.safety_net_floor
  const dllLimit = p.daily_loss_limit

  // Peak balance only moves up. Kept regardless of who owns the risk fields —
  // it is the basis of the fallback threshold below.
  let peak = row.peak_balance || 0
  peak = peak <= 0 ? Math.max(p.starting_balance, avail) : Math.max(peak, avail)
  row.peak_balance = peak

  // Trailing threshold: never goes down, capped at safety floor
  const initialThreshold = p.starting_balance - trail
  let prevThreshold = row.drawdown_auto || 0
  if (prevThreshold <= 0) prevThreshold = initialThreshold
  let threshold = Math.max(prevThreshold, peak - trail)
  threshold = Math.min(threshold, safety)

  if (!nt.has('drawdown_auto')) row.drawdown_auto = threshold
  if (!nt.has('trailing_max'))  row.trailing_max  = trail
  if (!nt.has('dist_drawdown')) row.dist_drawdown = avail - threshold

  // Daily loss
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  if (row.day_date !== today) {
    row.day_date = today
    row.day_start_balance = avail
    // New trading day — clear P&L carried over from the previous session,
    // EXCEPT anything NT8 supplied in this very batch, since zeroing a value it
    // just sent would blank a live number for the rest of the day.
    //
    // "in this batch" is the important part. This used to test nt_fields, which
    // is append-only: once NT8 sent RealizedProfitLoss even once, realized_pnl
    // counted as NT8-owned forever and the rollover could never clear it. NT8
    // only sends a realized item after a fill, so Friday's figure sat on the
    // dashboard through the weekend and into Monday, looking live because
    // NetLiquidation kept arriving alongside it. Ever-sent is not the same
    // question as sent-just-now.
    const owned = freshFields ?? nt
    if (!owned.has('realized_pnl'))   row.realized_pnl   = 0
    if (!owned.has('unrealized_pnl')) row.unrealized_pnl = 0
    if (!owned.has('dollar_open'))    row.dollar_open    = 0
  }

  if (!nt.has('dist_to_daily_loss')) {
    const dayStart = row.day_start_balance || avail
    const dailyLossUsed = Math.max(0, dayStart - avail)
    row.dist_to_daily_loss = Math.max(0, dllLimit - dailyLossUsed)
  }

  // dollar_open: respect NT8 if it sent it
  if (!onlyMissing || !nt.has('dollar_open')) {
    row.dollar_open = row.unrealized_pnl || row.dollar_open || 0
  }
}

// ── ENRICH ACCOUNT ───────────────────────────────────────────────────────────
// Port of main.py enrich_account() — mirror legacy aliases, optional compute
export function enrichAccount(
  row: AccountRow,
  compute = true,
  freshFields?: Set<string>,
): void {
  // net_liq is an alias of total_available and the two must stay equal. This
  // was a plain truthy test — `if (row.total_available) … else if (row.net_liq)`
  // — which cannot tell "equity is zero" apart from "equity was never set".
  //
  // When a prop firm liquidates a blown account NT8 reports equity of 0, that
  // 0 fell into the else-branch, and the PREVIOUS balance was copied straight
  // back over it. The row went on showing the money the account had before it
  // blew up, and the breach check in buildRow never saw a zero to act on. A
  // zero NT8 actually sent is data; only an absent value may be back-filled.
  const equityKnown = !!row.total_available || !!row.nt_fields?.includes('total_available')
  if (equityKnown) {
    row.net_liq = row.total_available
  } else if (row.net_liq) {
    row.total_available = row.net_liq
  }

  // dollar_open and unrealized_pnl mean the same thing — sync only when one is
  // truly absent (never sent by NT8). Do NOT use truthy check — that would
  // overwrite a legitimate 0 (position closed) with a stale non-zero value.
  if (row.dollar_open !== 0 && row.unrealized_pnl === 0 && !row.nt_fields?.includes('unrealized_pnl')) {
    row.unrealized_pnl = row.dollar_open
  } else if (row.unrealized_pnl !== 0 && row.dollar_open === 0 && !row.nt_fields?.includes('dollar_open')) {
    row.dollar_open = row.unrealized_pnl
  }

  if (compute) {
    computeTradovateMetrics(row, true, freshFields)
  }
}

// ── THRESHOLDS (mirror main.py constants) ────────────────────────────────────
export const DANGER_THRESHOLD  = 300
export const CAUTION_THRESHOLD = 700
export const ACCOUNT_TIMEOUT_SECONDS = 1800 // 30 min — matches AccountsGrid's offline threshold
