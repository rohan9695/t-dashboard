// supabase/functions/batch-update/index.ts
// Ingestion endpoint for the NT8 addon — same contract as the Next.js
// /api/batch-update route on Cloudflare/Netlify, but running inside Supabase
// itself, so batches land in the DB with no extra hosting vendor in between.
//
// Cost is FLAT in the number of accounts: one read and one upsert for the whole
// batch, whether that's 5 accounts or 50.
//
// Deploy:
//   npx supabase functions deploy batch-update --no-verify-jwt --project-ref gvbtnsktudmgmpamkhnl
// Secrets (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically):
//   npx supabase secrets set API_KEY=<same key the NT8 addon sends> --project-ref gvbtnsktudmgmpamkhnl
//
// --no-verify-jwt is required: the NT8 addon authenticates with X-Api-Key
// only (checked below), it does not send a Supabase JWT.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  ITEM_MAP,
  ITEM_PRIORITY,
  emptyAccount,
  enrichAccount,
  type AccountRow,
} from '../_shared/trading-logic.ts'

const API_KEY = Deno.env.get('API_KEY') ?? ''

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Payload: { "ACCOUNT_ID": { "NT8ItemName": value, ... }, ..., "_ts": <ms since epoch> }
type BatchPayload = Record<string, Record<string, number>> & { _ts?: number }

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ detail: 'Method not allowed' }, 405)
  }

  const key = req.headers.get('x-api-key')
  if (!API_KEY || key !== API_KEY) {
    return json({ detail: 'Unauthorized' }, 401)
  }

  let payload: BatchPayload
  try {
    payload = await req.json()
  } catch {
    return json({ detail: 'Invalid JSON' }, 400)
  }

  // _ts (client send-time, ms since epoch) is optional for backward compat —
  // a payload without it just disables the staleness guard.
  const batchTs = typeof payload._ts === 'number' ? payload._ts : Date.now()

  const accounts = Object.entries(payload).filter(([id]) =>
    id !== '_ts' && !id.toLowerCase().startsWith('sim'),
  )

  if (accounts.length === 0) {
    return json({ status: 'ok', processed: 0 })
  }

  // ── One read for the whole batch ──────────────────────────────────────────
  const ids = accounts.map(([id]) => id)
  const { data: existingRows, error: readError } = await supabase
    .from('accounts')
    .select('*')
    .in('account_id', ids)

  if (readError) {
    console.error('[batch-update] read failed:', readError.message)
    return json({ detail: readError.message }, 500)
  }

  const byId = new Map<string, AccountRow>(
    (existingRows ?? []).map((r) => [(r as AccountRow).account_id, r as AccountRow]),
  )

  const rows: AccountRow[] = []
  // Item names no recognised mapping exists for, echoed back so one curl shows
  // what NT8 is actually sending. Collected only, never stored.
  const unknown = new Set<string>()
  for (const [accountId, items] of accounts) {
    const row = buildRow(byId.get(accountId), accountId, items as Record<string, number>, batchTs, unknown)
    if (row) rows.push(row)
  }
  const unknownItems = unknown.size > 0 ? { unknown: [...unknown].sort() } : {}

  if (rows.length === 0) {
    return json({ status: 'ok', processed: 0, ...unknownItems })
  }

  // ── One write for the whole batch ─────────────────────────────────────────
  const { error: writeError } = await supabase
    .from('accounts')
    .upsert(rows, { onConflict: 'account_id' })

  if (!writeError) {
    return json({ status: 'ok', processed: rows.length, ...unknownItems })
  }

  // A bulk write is all-or-nothing, so one malformed row would otherwise lose
  // the whole batch. Fall back to per-account writes to salvage the rest.
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
    return json({ status: 'partial', processed: rows.length - failed.length, failed: failed.length, ...unknownItems }, 500)
  }

  return json({ status: 'ok', processed: rows.length, ...unknownItems })
})
