// app/api/set-leader/route.ts
// POST { account_id } — marks one account as the Replikanto leader and demotes
// whichever account currently holds the role.
//
// The leader drives the copier-failure banner and the sort order, so it has to
// be settable somewhere. The Settings page that used to do this was deleted
// along with the rest of the unreachable UI, so this is now the only way in:
//
//   curl -X POST https://<host>/api/set-leader \
//        -H "X-Api-Key: $API_KEY" -H 'Content-Type: application/json' \
//        -d '{"account_id":"PAAPEX3480290000007"}'
//
// Unlike the previous version this is NOT in the middleware's open list — that
// one accepted a leader change from anyone who knew the URL.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  let body: { account_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 })
  }

  const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : ''
  if (!accountId) {
    return NextResponse.json({ detail: 'account_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Refuse to point the role at an account that does not exist — a typo would
  // otherwise leave every account a follower and silently disable the banner.
  const { data: target, error: readError } = await supabase
    .from('accounts')
    .select('account_id')
    .eq('account_id', accountId)
    .maybeSingle()

  if (readError) {
    console.error('[set-leader] read failed:', readError.message)
    return NextResponse.json({ detail: readError.message }, { status: 500 })
  }
  if (!target) {
    return NextResponse.json({ detail: `unknown account: ${accountId}` }, { status: 404 })
  }

  // Demote the incumbent first, so a failure here cannot leave two leaders.
  const { error: demoteError } = await supabase
    .from('accounts')
    .update({ replikanto_role: 'follower' })
    .eq('replikanto_role', 'leader')

  if (demoteError) {
    console.error('[set-leader] demote failed:', demoteError.message)
    return NextResponse.json({ detail: demoteError.message }, { status: 500 })
  }

  const { error: promoteError } = await supabase
    .from('accounts')
    .update({ replikanto_role: 'leader' })
    .eq('account_id', accountId)

  if (promoteError) {
    console.error('[set-leader] promote failed:', promoteError.message)
    return NextResponse.json({ detail: promoteError.message }, { status: 500 })
  }

  return NextResponse.json({ status: 'ok', leader: accountId })
}
