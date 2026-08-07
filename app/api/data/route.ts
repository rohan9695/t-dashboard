// app/api/data/route.ts
// Mirrors main.py GET /data — returns accounts dict keyed by account_id
// Used as a REST fallback; the dashboard uses Supabase Realtime primarily.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ACCOUNT_TIMEOUT_SECONDS } from '@/lib/trading-logic'

export async function GET(req: NextRequest) {
  // Simple session check — if using Supabase Auth, validate JWT here
  // For now: require the API key (same pattern as dashboard auth in main.py)
  const apiKey = req.headers.get('x-api-key')
  if (apiKey && apiKey !== process.env.API_KEY) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // ?all=1 returns every account, skipping the staleness cutoff. The dashboard
  // uses it as a fallback data source and needs the same set of rows it would
  // get from Supabase directly — with the cutoff applied, an account NT8 has
  // gone quiet on would drop out of the list entirely instead of showing as
  // offline.
  const includeAll = req.nextUrl.searchParams.get('all') === '1'
  const cutoff = new Date(Date.now() - ACCOUNT_TIMEOUT_SECONDS * 1000).toISOString()

  let query = supabase.from('accounts').select('*')
  if (!includeAll) {
    query = query.gte('last_update', cutoff)  // mirrors cleanup_accounts()
  }

  const { data, error } = await query.order('account_id')

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 })
  }

  // Return as dict keyed by account_id — same shape as main.py /data
  const result: Record<string, unknown> = {}
  for (const row of data ?? []) {
    result[row.account_id] = row
  }

  return NextResponse.json(result)
}
