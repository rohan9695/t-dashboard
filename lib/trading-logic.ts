// lib/trading-logic.ts
// Direct TypeScript port of main.py:
//   ITEM_MAP, ACCOUNT_SIZE_PROFILES, compute_tradovate_metrics, enrich_account
// Keep this in sync if you update the Python version.

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
  GrossRealizedProfitLoss:   'realized_pnl',
  // Task 6: new Tradovate fields from NT8 addon
  TrailingDrawdownValue:     'tradovate_trailing_drawdown',
  RealizedPnL:               'tradovate_realized_pnl',
  UnrealizedPnL:             'tradovate_unrealized_pnl',
  ExcessIntradayMargin:      'tradovate_margin_used',
  DailyPnL:                  'tradovate_daily_pnl',
}

// ── ACCOUNT SIZE PROFILES ────────────────────────────────────────────────────
// (min_balance, starting, trailing_max, daily_loss_limit, safety_net_floor)
// Edit these to match your actual Apex PA tiers
const ACCOUNT_SIZE_PROFILES: [number, number, number, number, number][] = [
  [140000, 150000, 4000, 1500, 150100],
  [ 90000, 100000, 3000, 1200, 100100],
  [ 45000,  50000, 2000, 1000,  50100],
  [ 20000,  25000, 1000,  500,  25100],
]

const APEX_50K_DEFAULT = {
  starting_balance:  50000,
  trailing_max:       2000,
  daily_loss_limit:   1000,
  safety_net_floor:  50100,
}

export interface AccountProfile {
  starting_balance:  number
  trailing_max:      number
  daily_loss_limit:  number
  safety_net_floor:  number
}

export function detectAccountProfile(balance: number): AccountProfile {
  for (const [minBal, start, trail, dll, safety] of ACCOUNT_SIZE_PROFILES) {
    if (balance >= minBal) {
      return {
        starting_balance:  start,
        trailing_max:      trail,
        daily_loss_limit:  dll,
        safety_net_floor:  safety,
      }
    }
  }
  return { ...APEX_50K_DEFAULT }
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
}

// ── COMPUTE TRADOVATE METRICS ────────────────────────────────────────────────
// Port of main.py compute_tradovate_metrics()
// onlyMissing = true → don't overwrite fields NT8 already sent
export function computeTradovateMetrics(
  row: AccountRow,
  onlyMissing = true,
): void {
  const avail = row.total_available || 0
  if (avail <= 0) return

  const p = detectAccountProfile(avail)
  const trail    = p.trailing_max
  const safety   = p.safety_net_floor
  const dllLimit = p.daily_loss_limit

  // Peak balance only moves up
  let peak = row.peak_balance || 0
  peak = peak <= 0 ? Math.max(p.starting_balance, avail) : Math.max(peak, avail)
  row.peak_balance = peak

  // Trailing threshold: never goes down, capped at safety floor
  const initialThreshold = p.starting_balance - trail
  let prevThreshold = row.drawdown_auto || 0
  if (prevThreshold <= 0) prevThreshold = initialThreshold
  let threshold = Math.max(prevThreshold, peak - trail)
  threshold = Math.min(threshold, safety)

  const nt = new Set(row.nt_fields || [])
  function setField(key: keyof AccountRow, value: number) {
    if (onlyMissing && nt.has(key)) return
    ;(row as unknown as Record<string, unknown>)[key] = value
  }

  setField('drawdown_auto',      threshold)
  setField('trailing_max',       trail)
  setField('dist_drawdown',      avail - threshold)

  // Daily loss
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  if (row.day_date !== today) {
    row.day_date = today
    row.day_start_balance = avail
  }
  const dayStart = row.day_start_balance || avail
  const dailyLossUsed = Math.max(0, dayStart - avail)
  setField('dist_to_daily_loss', Math.max(0, dllLimit - dailyLossUsed))

  if (!nt.has('dollar_open')) {
    row.dollar_open = row.unrealized_pnl || row.dollar_open || 0
  }
}

// ── ENRICH ACCOUNT ───────────────────────────────────────────────────────────
// Port of main.py enrich_account() — mirror legacy aliases, optional compute
export function enrichAccount(
  row: AccountRow,
  compute = true,
): void {
  if (row.total_available) {
    row.net_liq = row.total_available
  } else if (row.net_liq) {
    row.total_available = row.net_liq
  }

  if (row.dollar_open && !row.unrealized_pnl) {
    row.unrealized_pnl = row.dollar_open
  } else if (row.unrealized_pnl && !row.dollar_open) {
    row.dollar_open = row.unrealized_pnl
  }

  if (compute && row.source !== 'ninjatrader') {
    computeTradovateMetrics(row, true)
  }
}

// ── THRESHOLDS (mirror main.py constants) ────────────────────────────────────
export const DANGER_THRESHOLD  = 300
export const CAUTION_THRESHOLD = 700
export const ACCOUNT_TIMEOUT_SECONDS = 60
