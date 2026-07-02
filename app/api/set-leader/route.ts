// app/api/set-leader/route.ts
// POST { account_id } — marks one account as the Replikanto leader and
// demotes any other current leader to follower. Open (no token) to match
// the dashboard's current unauthenticated posture — see middleware.ts.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  let body: { account_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 })
  }

  const accountId = typeof body.account_id === 'string' ? body.account_id : ''
  if (!accountId) {
    return NextResponse.json({ detail: 'account_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { error: demoteError } = await supabase
    .from('accounts')
    .update({ replikanto_role: 'follower' })
    .eq('replikanto_role', 'leader')
    .neq('account_id', accountId)

  if (demoteError) {
    return NextResponse.json({ detail: demoteError.message }, { status: 500 })
  }

  const { error: promoteError } = await supabase
    .from('accounts')
    .update({ replikanto_role: 'leader' })
    .eq('account_id', accountId)

  if (promoteError) {
    return NextResponse.json({ detail: promoteError.message }, { status: 500 })
  }

  return NextResponse.json({ status: 'ok', leader: accountId })
}
