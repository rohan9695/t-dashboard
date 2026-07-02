// app/api/sync-accounts/route.ts
// Called by the NT8 addon only when its live account list changes (an
// account was added or removed) — not on a timer. Diffs against Supabase
// and soft-hides accounts NT8 no longer reports. Never hard-deletes.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { emptyAccount, type AccountRow } from '@/lib/trading-logic'

const API_KEY = process.env.API_KEY ?? 'change-me-set-in-env-file'

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-api-key') ?? req.headers.get('X-Api-Key')
  if (key !== API_KEY) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  let body: { live_accounts?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 })
  }

  const liveAccounts = Array.isArray(body.live_accounts)
    ? body.live_accounts.filter((id): id is string => typeof id === 'string')
    : []

  const supabase = createServiceClient()
  const liveSet = new Set(liveAccounts)

  const { data: rows, error } = await supabase
    .from('accounts')
    .select('account_id, hidden')

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 })
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

  return NextResponse.json({
    status: 'ok',
    hidden: toHide.length,
    shown: toShow.length,
    created: toCreate.length,
  })
}
