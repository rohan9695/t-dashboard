// app/api/batch-update/route.ts
// Single endpoint that accepts ALL account updates at once.
// NT8 addon batches item updates for 3s then sends one POST here,
// regardless of how many accounts or fields changed.
//
// Cost is FLAT in the number of accounts: one read for the whole batch and one
// upsert for the whole batch, whether that's 5 accounts or 50. It used to be a
// read plus a write PER ACCOUNT — at a 3s cadence that was 12k queries an hour
// for 5 accounts and 120k for 50, so adding accounts quietly multiplied the
// database load and the time each batch took.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  ITEM_MAP,
  ITEM_PRIORITY,
  emptyAccount,
  enrichAccount,
  type AccountRow,
} from '@/lib/trading-logic'


const API_KEY = process.env.API_KEY ?? 'change-me-set-in-env-file'

// Payload: { "ACCOUNT_ID": { "NT8ItemName": value, ... }, ..., "_ts": <ms since epoch> }
type BatchPayload = Record<string, Record<string, number>> & { _ts?: number }

// Pure: folds one account's items onto its stored row. Returns null when the
// batch should not be applied at all (stale, or nothing recognisable in it).
function buildRow(
  existing: AccountRow | undefined,
  accountId: string,
  items: Record<string, number>,
  batchTs: number,
): AccountRow | null {
  // Multi-host fan-out means several hosts can process overlapping batches for
  // the same account concurrently. Refuse to apply a batch older than whatever
  // is already stored, so an in-flight stale write can never clobber fresher
  // data another host already wrote.
  if (existing && typeof existing.last_batch_ts === 'number' && batchTs <= existing.last_batch_ts!) {
    return null
  }

  const row: AccountRow = existing ?? (() => {
    const r = emptyAccount(); r.account_id = accountId; return r
  })()
  row.last_batch_ts = batchTs

  let anyKnown = false
  // Best ITEM_PRIORITY already applied to each field in this batch, so a weaker
  // source (CashValue) can never overwrite a stronger one (NetLiquidation)
  // just by appearing later in the payload.
  const appliedPriority: Record<string, number> = {}

  for (const [itemName, value] of Object.entries(items)) {
    const field = ITEM_MAP[itemName]
    if (!field) continue
    anyKnown = true

    const priority = ITEM_PRIORITY[itemName] ?? 0
    if (field in appliedPriority && appliedPriority[field] > priority) continue
    appliedPriority[field] = priority

    ;(row as unknown as Record<string, unknown>)[field] = value

    // Keep open P&L fields in sync — clearing one must clear both
    if (field === 'dollar_open')    row.unrealized_pnl = value
    if (field === 'unrealized_pnl') row.dollar_open    = value

    if (!row.nt_fields.includes(field)) {
      row.nt_fields = [...row.nt_fields, field]
    }
  }

  if (!anyKnown) return null // all items were unknown — nothing to write

  enrichAccount(row, true)
  row.last_update = new Date().toISOString()

  // An account actively sending data is live by definition. This must
  // override any hidden=true — sync-accounts can wrongly hide a live account
  // during NT8 connection churn (partial live lists at startup), and this
  // full-row upsert would otherwise round-trip that stale flag forever.
  row.hidden = false

  if (
    row.total_available > 0 &&
    ((row.dist_drawdown ?? 0) <= 0 || (row.dist_to_daily_loss ?? 0) <= 0)
  ) {
    row.status = 'breached'
  } else {
    row.status = 'active'
  }

  return row
}

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-api-key') ?? req.headers.get('X-Api-Key')
  if (key !== API_KEY) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  let payload: BatchPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 })
  }

  // _ts (client send-time, ms since epoch) is optional for backward compat —
  // older addon builds without it just disable the staleness guard (always
  // applies, matching the previous behavior).
  const batchTs = typeof payload._ts === 'number' ? payload._ts : Date.now()

  const accounts = Object.entries(payload).filter(([id]) =>
    id !== '_ts' && !id.toLowerCase().startsWith('sim'),
  )

  if (accounts.length === 0) {
    return NextResponse.json({ status: 'ok', processed: 0 })
  }

  const supabase = createServiceClient()

  // ── One read for the whole batch ──────────────────────────────────────────
  const ids = accounts.map(([id]) => id)
  const { data: existingRows, error: readError } = await supabase
    .from('accounts')
    .select('*')
    .in('account_id', ids)

  if (readError) {
    console.error('[batch-update] read failed:', readError.message)
    return NextResponse.json({ detail: readError.message }, { status: 500 })
  }

  const byId = new Map<string, AccountRow>(
    (existingRows ?? []).map((r) => [(r as AccountRow).account_id, r as AccountRow]),
  )

  const rows: AccountRow[] = []
  for (const [accountId, items] of accounts) {
    const row = buildRow(byId.get(accountId), accountId, items as Record<string, number>, batchTs)
    if (row) rows.push(row)
  }

  if (rows.length === 0) {
    // Every account was stale or carried nothing recognisable.
    return NextResponse.json({ status: 'ok', processed: 0 })
  }

  // ── One write for the whole batch ─────────────────────────────────────────
  const { error: writeError } = await supabase
    .from('accounts')
    .upsert(rows, { onConflict: 'account_id' })

  if (!writeError) {
    return NextResponse.json({ status: 'ok', processed: rows.length })
  }

  // A bulk write is all-or-nothing, so one malformed row would otherwise lose
  // the whole batch. Fall back to per-account writes to salvage the rest, and
  // report how many actually landed.
  console.error('[batch-update] bulk upsert failed, retrying individually:', writeError.message)

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      const { error } = await supabase.from('accounts').upsert(row, { onConflict: 'account_id' })
      if (error) throw new Error(`${row.account_id}: ${error.message}`)
    }),
  )

  const failed = results.filter((r) => r.status === 'rejected')
  for (const f of failed) {
    console.error('[batch-update] upsert failed:', (f as PromiseRejectedResult).reason)
  }

  if (failed.length > 0) {
    return NextResponse.json(
      { status: 'partial', processed: rows.length - failed.length, failed: failed.length },
      { status: 500 },
    )
  }

  return NextResponse.json({ status: 'ok', processed: rows.length })
}
