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


// Unset means "reject everything", never a published default. The old
// fallback was a literal in this repo, so a host that forgot the variable
// accepted a key anyone could read here — middleware happened to block it
// first, but that left one layer holding a door that should not exist. The
// Deno edge functions already fail closed this way; this matches them.
const API_KEY = process.env.API_KEY ?? ''

// Payload: { "ACCOUNT_ID": { "NT8ItemName": value, ... }, ..., "_ts": <ms since epoch>, "_replikanto": "online"|"off"|"away"|"unknown" }
type BatchPayload = Record<string, Record<string, number>> & { _ts?: number; _replikanto?: string }

// How far ahead of THIS server a stored last_batch_ts may legitimately sit.
// _ts is the NT8 machine's clock, so the two are only loosely related; a few
// minutes covers ordinary drift between hosts.
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000

// Pure: folds one account's items onto its stored row. Returns null when the
// batch should not be applied at all (stale, or nothing recognisable in it).
function buildRow(
  existing: AccountRow | undefined,
  accountId: string,
  items: Record<string, number>,
  batchTs: number,
  unknownOut?: Set<string>,
  replikantoStatus?: string,
): AccountRow | null {
  // Multi-host fan-out means several hosts can process overlapping batches for
  // the same account concurrently. Refuse to apply a batch older than whatever
  // is already stored, so an in-flight stale write can never clobber fresher
  // data another host already wrote.
  //
  // But _ts is the NT8 MACHINE's clock, not this server's. A clock that ran
  // ahead — or corrected backwards after an NTP sync — leaves a stored value
  // in the future, and then every subsequent batch is refused. That failed
  // silently: HTTP 200, processed:0, no log the trader ever sees, the
  // dashboard frozen while every other indicator reads healthy. A stored
  // timestamp minutes into this server's future cannot be legitimate, so
  // ignore the guard rather than lock the account out.
  //
  // Trade-off: on a machine whose clock is PERSISTENTLY ahead, the ordering
  // guard stays disabled and a stale write from another host could land. That
  // costs one out-of-order update; the alternative costs all of them.
  if (existing && typeof existing.last_batch_ts === 'number') {
    const stored = existing.last_batch_ts!
    const storedIsImpossible = stored > Date.now() + CLOCK_SKEW_TOLERANCE_MS
    if (!storedIsImpossible && batchTs <= stored) return null
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
    if (!field) {
      // Dropped, as before — but no longer without a trace. An unmapped item
      // is indistinguishable from one that was never sent, which is how a
      // gross-only realized P&L feed hid for months: the value arrived every
      // second and vanished on arrival.
      unknownOut?.add(itemName)
      continue
    }
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

  // Same value on every account row in the batch — it's Replikanto's one link
  // state, not per-account. Only overwrite when the addon actually sent it, so
  // an older addon build (or a batch that omitted it) never blanks a
  // previously-known status.
  if (replikantoStatus) row.replikanto_status = replikantoStatus

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
  // !API_KEY matters as much as the comparison: with both sides empty an
  // empty X-Api-Key header would compare equal and authenticate.
  if (!API_KEY || key !== API_KEY) {
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
  const replikantoStatus = typeof payload._replikanto === 'string' ? payload._replikanto : undefined

  // Anything prefixed with _ is batch METADATA, not an account. Without this
  // guard a key like _replikanto is taken for an account id and its string
  // value is iterated character by character into a garbage row. Reserving the
  // prefix means the addon can add metadata later without a matching deploy
  // here — the ordering hazard that makes such additions dangerous.
  const accounts = Object.entries(payload).filter(([id]) =>
    !id.startsWith('_') && !id.toLowerCase().startsWith('sim'),
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
  // Item names no recognised mapping exists for, echoed back so one curl shows
  // what NT8 is actually sending. Collected only, never stored.
  const unknown = new Set<string>()
  for (const [accountId, items] of accounts) {
    const row = buildRow(byId.get(accountId), accountId, items as Record<string, number>, batchTs, unknown, replikantoStatus)
    if (row) rows.push(row)
  }
  const unknownItems = unknown.size > 0 ? { unknown: [...unknown].sort() } : {}

  if (rows.length === 0) {
    // Every account was stale or carried nothing recognisable.
    return NextResponse.json({ status: 'ok', processed: 0, ...unknownItems })
  }

  // ── One write for the whole batch ─────────────────────────────────────────
  const { error: writeError } = await supabase
    .from('accounts')
    .upsert(rows, { onConflict: 'account_id' })

  if (!writeError) {
    return NextResponse.json({ status: 'ok', processed: rows.length, ...unknownItems })
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
      { status: 'partial', processed: rows.length - failed.length, failed: failed.length, ...unknownItems },
      { status: 500 },
    )
  }

  return NextResponse.json({ status: 'ok', processed: rows.length, ...unknownItems })
}
