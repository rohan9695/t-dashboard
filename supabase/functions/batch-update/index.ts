// supabase/functions/batch-update/index.ts
// Third ingestion endpoint for the NT8 addon — same contract as the Next.js
// /api/batch-update route on Cloudflare/Netlify, but running inside Supabase
// itself, so batches land in the DB with no extra hosting vendor in between.
// Free tier: 500k invocations/month (vs Netlify's ~125k), so this can take
// the always-on fan-out load that was burning Netlify's quota.
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

async function processAccount(
  accountId: string,
  items: Record<string, number>,
  batchTs: number,
): Promise<void> {
  const { data } = await supabase
    .from('accounts')
    .select('*')
    .eq('account_id', accountId)
    .single()

  // Multi-host fan-out means several hosts can process overlapping batches
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
  for (const [itemName, value] of Object.entries(items)) {
    const field = ITEM_MAP[itemName]
    if (!field) continue
    anyKnown = true
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

  await supabase.from('accounts').upsert(row, { onConflict: 'account_id' })
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

  // Process all accounts in parallel — one DB read+write per account
  await Promise.all(
    accounts.map(([accountId, items]) =>
      processAccount(accountId, items as Record<string, number>, batchTs),
    ),
  )

  return json({ status: 'ok', processed: accounts.length })
})
