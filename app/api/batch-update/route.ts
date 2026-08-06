// app/api/batch-update/route.ts
// Single endpoint that accepts ALL account updates at once.
// NT8 addon batches item updates for 3s then sends one POST here,
// regardless of how many accounts or fields changed.
// 1 Cloudflare invocation per batch interval — scales to any account count.

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

async function processAccount(
  supabase: ReturnType<typeof createServiceClient>,
  accountId: string,
  items: Record<string, number>,
  batchTs: number,
): Promise<void> {
  const { data } = await supabase
    .from('accounts')
    .select('*')
    .eq('account_id', accountId)
    .single()

  // Triple-host fan-out means multiple hosts can process overlapping batches
  // for the same account concurrently. Refuse to apply a batch older than
  // whatever's already stored, so an in-flight stale write can never clobber
  // fresher data that another host already wrote.
  if (data && typeof (data as AccountRow).last_batch_ts === 'number' && batchTs <= (data as AccountRow).last_batch_ts!) {
    return
  }

  const row: AccountRow = data ? (data as AccountRow) : (() => {
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

  if (!anyKnown) return // all items were unknown — nothing to write

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

  // A failed write here used to be invisible: the endpoint still returned
  // {status:'ok'} and the dashboard just kept showing the last good row, which
  // is indistinguishable from "NT8 sent nothing". Log it so a silent write
  // failure is diagnosable from the host's logs.
  const { error } = await supabase
    .from('accounts')
    .upsert(row, { onConflict: 'account_id' })

  if (error) {
    console.error(`[batch-update] upsert failed for ${accountId}:`, error.message)
    throw new Error(`upsert failed for ${accountId}: ${error.message}`)
  }
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

  // Process all accounts in parallel — one DB read+write per account.
  // allSettled, not all: one account failing must not discard the writes for
  // every other account in the same batch.
  const results = await Promise.allSettled(
    accounts.map(([accountId, items]) =>
      processAccount(supabase, accountId, items as Record<string, number>, batchTs),
    ),
  )

  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed > 0) {
    return NextResponse.json(
      { status: 'partial', processed: accounts.length - failed, failed },
      { status: 500 },
    )
  }

  return NextResponse.json({ status: 'ok', processed: accounts.length })
}
