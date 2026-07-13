// supabase/functions/sync-accounts/index.ts
// Edge-function twin of the Next.js /api/sync-accounts route. Called by the
// NT8 addon only when its live account list changes — soft-hides accounts
// NT8 no longer reports. Never hard-deletes.
//
// Deploy:
//   npx supabase functions deploy sync-accounts --no-verify-jwt --project-ref gvbtnsktudmgmpamkhnl
// Secrets: API_KEY (shared with batch-update; SUPABASE_* are injected automatically).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { emptyAccount, type AccountRow } from '../_shared/trading-logic.ts'

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ detail: 'Method not allowed' }, 405)
  }

  const key = req.headers.get('x-api-key')
  if (!API_KEY || key !== API_KEY) {
    return json({ detail: 'Unauthorized' }, 401)
  }

  let body: { live_accounts?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ detail: 'Invalid JSON' }, 400)
  }

  const liveAccounts = Array.isArray(body.live_accounts)
    ? body.live_accounts.filter((id): id is string => typeof id === 'string')
    : []

  const liveSet = new Set(liveAccounts)

  const { data: rows, error } = await supabase
    .from('accounts')
    .select('account_id, hidden')

  if (error) {
    return json({ detail: error.message }, 500)
  }

  const known = new Set((rows ?? []).map((r) => r.account_id as string))
  const toHide = (rows ?? [])
    .filter((r) => !liveSet.has(r.account_id as string) && !r.hidden)
    .map((r) => r.account_id as string)
  const toShow = (rows ?? [])
    .filter((r) => liveSet.has(r.account_id as string) && r.hidden)
    .map((r) => r.account_id as string)
  const toCreate = liveAccounts.filter((id) => !known.has(id))

  if (toHide.length > 0) {
    await supabase.from('accounts').update({ hidden: true }).in('account_id', toHide)
  }
  if (toShow.length > 0) {
    await supabase.from('accounts').update({ hidden: false }).in('account_id', toShow)
  }
  if (toCreate.length > 0) {
    const newRows: AccountRow[] = toCreate.map((id) => {
      const row = emptyAccount()
      row.account_id = id
      return row
    })
    await supabase.from('accounts').upsert(newRows, { onConflict: 'account_id' })
  }

  return json({
    status: 'ok',
    hidden: toHide.length,
    shown: toShow.length,
    created: toCreate.length,
  })
})
