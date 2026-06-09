// app/api/update/route.ts
// Drop-in replacement for main.py POST /update
// Accepts the exact same three payload shapes your NT8 addon already sends:
//   1. ItemUpdate  — { account, item, value, timestamp? }
//   2. Snapshot    — { account, total_available, drawdown_auto, … }
//   3. FullUpdate  — { account, dollar_open, dist_to_daily_loss, … }

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  ITEM_MAP,
  emptyAccount,
  enrichAccount,
  computeTradovateMetrics,
  ACCOUNT_TIMEOUT_SECONDS,
  type AccountRow,
} from '@/lib/trading-logic'

export const runtime = 'edge'

const API_KEY = process.env.API_KEY ?? 'change-me-set-in-env-file'

// ── Auth ─────────────────────────────────────────────────────────────────────
function checkApiKey(req: NextRequest): boolean {
  const key = req.headers.get('x-api-key') ?? req.headers.get('X-Api-Key')
  return key === API_KEY
}

// ── Fetch existing row from Supabase (or empty) ───────────────────────────────
async function fetchRow(
  supabase: ReturnType<typeof createServiceClient>,
  accountId: string,
): Promise<AccountRow> {
  const { data } = await supabase
    .from('accounts')
    .select('*')
    .eq('account_id', accountId)
    .single()

  if (!data) {
    const row = emptyAccount()
    row.account_id = accountId
    return row
  }
  return data as AccountRow
}

// ── Upsert row back to Supabase ───────────────────────────────────────────────
async function upsertRow(
  supabase: ReturnType<typeof createServiceClient>,
  row: AccountRow,
) {
  row.last_update = new Date().toISOString()

  // Mark stale accounts
  const cutoff = new Date(Date.now() - ACCOUNT_TIMEOUT_SECONDS * 1000).toISOString()
  row.status = row.last_update >= cutoff ? 'active' : 'stale'

  const { error } = await supabase
    .from('accounts')
    .upsert(row, { onConflict: 'account_id' })

  if (error) throw new Error(error.message)
}

// ── Auto risk lockout (Task 5) ────────────────────────────────────────────────
// Returns true if the account is locked and the update should be skipped.
async function checkRiskLockout(
  supabase: ReturnType<typeof createServiceClient>,
  accountId: string,
  row: AccountRow,
): Promise<boolean> {
  // Fetch last 3 events to count consecutive bad readings
  const { data: events } = await supabase
    .from('account_events')
    .select('event_type')
    .eq('account_id', accountId)
    .order('occurred_at', { ascending: false })
    .limit(3)

  if (!events || events.length < 3) return false

  const allBad = events.every((e) => e.event_type === 'risk_breach')
  if (!allBad) return false

  // Check if already locked
  const { data: acct } = await supabase
    .from('accounts')
    .select('locked')
    .eq('account_id', accountId)
    .single()

  if ((acct as Record<string, unknown> | null)?.locked === true) return true

  // Lock it
  await supabase
    .from('accounts')
    .update({ locked: true } as unknown as AccountRow)
    .eq('account_id', accountId)

  await supabase.from('account_events').insert({
    account_id:  accountId,
    event_type:  'auto_locked',
    message:     '3 consecutive risk breach readings',
    occurred_at: new Date().toISOString(),
  })

  return true
}

// ── Log account event ─────────────────────────────────────────────────────────
async function logEvent(
  supabase: ReturnType<typeof createServiceClient>,
  accountId: string,
  eventType: string,
  message: string,
): Promise<void> {
  await supabase.from('account_events').insert({
    account_id:  accountId,
    event_type:  eventType,
    message,
    occurred_at: new Date().toISOString(),
  })
}

// ── Handlers (mirror main.py apply_* functions) ───────────────────────────────

async function handleItemUpdate(
  supabase: ReturnType<typeof createServiceClient>,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const accountId = String(body.account)
  const itemName  = String(body.item)
  const value     = Number(body.value)

  const field = ITEM_MAP[itemName]
  if (!field) {
    // Unknown item — log it but don't error (mirrors main.py behavior)
    console.warn(`[update] unknown NT8 item: ${itemName}`)
    return NextResponse.json({ status: 'ok', unknown_item: itemName })
  }

  const row = await fetchRow(supabase, accountId)

  ;(row as unknown as Record<string, unknown>)[field] = value

  // Track which fields NT8 sent (mirrors row["nt_fields"])
  if (!row.nt_fields.includes(field)) {
    row.nt_fields = [...row.nt_fields, field]
  }

  // Task 6: stamp synced_at when any Tradovate field arrives
  const TRADOVATE_FIELDS = new Set([
    'tradovate_trailing_drawdown', 'tradovate_realized_pnl',
    'tradovate_unrealized_pnl', 'tradovate_margin_used', 'tradovate_daily_pnl',
  ])
  if (TRADOVATE_FIELDS.has(field)) {
    row.tradovate_synced_at = new Date().toISOString()
  }

  enrichAccount(row, true /* compute */)
  await upsertRow(supabase, row)

  return NextResponse.json({ status: 'ok', field })
}

async function handleSnapshot(
  supabase: ReturnType<typeof createServiceClient>,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  // Authoritative snapshot from NT8 add-on — mirrors apply_snapshot()
  const accountId = String(body.account)
  const existing  = await fetchRow(supabase, accountId)

  const row: AccountRow = {
    ...emptyAccount(),
    account_id:         accountId,
    dollar_open:        Number(body.dollar_open        ?? 0),
    dist_to_daily_loss: Number(body.dist_to_daily_loss ?? 0),
    drawdown_auto:      Number(body.drawdown_auto      ?? 0),
    total_available:    Number(body.total_available    ?? 0),
    trailing_max:       Number(body.trailing_max       ?? 0),
    dist_drawdown:      Number(body.dist_drawdown      ?? 0),
    unrealized_pnl:     Number(body.dollar_open        ?? 0),
    source:             'ninjatrader',
    nt_fields: [
      'dollar_open','dist_to_daily_loss','drawdown_auto',
      'total_available','trailing_max','dist_drawdown',
    ],
    // Preserve persisted state across snapshots
    peak_balance:      existing.peak_balance,
    day_start_balance: existing.day_start_balance,
    day_date:          existing.day_date,
    realized_pnl:      existing.realized_pnl,
    net_liq:           0,
    last_update:       new Date().toISOString(),
    status:            'active',
  }

  enrichAccount(row, false /* don't recompute — NT8 sent authoritative values */)
  await upsertRow(supabase, row)

  return NextResponse.json({ status: 'ok', mode: 'snapshot' })
}

async function handleFullUpdate(
  supabase: ReturnType<typeof createServiceClient>,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  // Legacy full update — mirrors apply_full_update()
  const accountId = String(body.account)
  const existing  = await fetchRow(supabase, accountId)

  const row: AccountRow = {
    ...existing,
    account_id:         accountId,
    dollar_open:        Number(body.dollar_open        ?? body.unrealized_pnl ?? 0),
    dist_to_daily_loss: Number(body.dist_to_daily_loss ?? 0),
    drawdown_auto:      Number(body.drawdown_auto      ?? 0),
    total_available:    Number(body.total_available    ?? body.net_liq ?? 0),
    trailing_max:       Number(body.trailing_max       ?? 0),
    dist_drawdown:      Number(body.dist_drawdown      ?? 0),
    unrealized_pnl:     Number(body.unrealized_pnl    ?? 0),
    realized_pnl:       Number(body.realized_pnl      ?? 0),
  }

  enrichAccount(row, false)
  await upsertRow(supabase, row)

  return NextResponse.json({ status: 'ok' })
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Check if account is auto-locked before processing
  const accountId = String(body.account)
  const isLocked = await checkRiskLockout(supabase, accountId, await fetchRow(supabase, accountId))
  if (isLocked) {
    return NextResponse.json({ status: 'locked', reason: 'auto_risk_lockout' })
  }

  try {
    // Route to correct handler — same logic as main.py @app.post("/update")
    let result: NextResponse
    if ('item' in body) {
      result = await handleItemUpdate(supabase, body)
    } else if ('total_available' in body && 'drawdown_auto' in body) {
      result = await handleSnapshot(supabase, body)
    } else {
      result = await handleFullUpdate(supabase, body)
    }

    // Log risk breach event if account is breached (for auto-lockout tracking)
    const updatedRow = await fetchRow(supabase, accountId)
    if (updatedRow.status === 'breached') {
      logEvent(supabase, accountId, 'risk_breach',
        `dist_drawdown=${updatedRow.dist_drawdown} dist_daily=${updatedRow.dist_to_daily_loss}`
      )
    }

    return result
  } catch (err) {
    console.error('[update] error:', err)
    return NextResponse.json({ detail: String(err) }, { status: 500 })
  }
}
