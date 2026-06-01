// app/api/data/route.ts
// Mirrors main.py GET /data — returns accounts dict keyed by account_id
// Used as a REST fallback; the dashboard uses Supabase Realtime primarily.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ACCOUNT_TIMEOUT_SECONDS } from '@/lib/trading-logic'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  // Simple session check — if using Supabase Auth, validate JWT here
  // For now: require the API key (same pattern as dashboard auth in main.py)
  const apiKey = req.headers.get('x-api-key')
  if (apiKey && apiKey !== process.env.API_KEY) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - ACCOUNT_TIMEOUT_SECONDS * 1000).toISOString()

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .gte('last_update', cutoff)  // mirrors cleanup_accounts()
    .order('account_id')

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
