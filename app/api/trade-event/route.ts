// app/api/trade-event/route.ts
// POST a fill from the NT8 addon. This is the missing producer for the
// trade_events table: ToastProvider has always subscribed to inserts here, but
// nothing ever wrote a row, so the fill notifications could never fire.
//
// One row per account per fill. The dashboard aggregates them client-side over
// a 1.5s window, so posting five rows for a five-account fill produces one
// "5 accounts" toast — the addon does not need to batch them itself.
//
// total_accounts is how many accounts the addon EXPECTED the trade to hit. When
// fewer rows arrive than that, the dashboard raises the "1 account only"
// warning instead of the normal confirmation. Getting this number right is what
// makes the alert meaningful, so it must be the size of the live account set at
// the moment of the fill, not the number of fills already sent.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const API_KEY = process.env.API_KEY ?? 'change-me-set-in-env-file'

const EVENT_TYPES = new Set(['open', 'close', 'partial'])
const DIRECTIONS  = new Set(['long', 'short', 'flat'])

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-api-key') ?? req.headers.get('X-Api-Key')
  if (key !== API_KEY) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 })
  }

  const accountId = typeof body.account === 'string' ? body.account : ''
  const symbol    = typeof body.symbol === 'string' ? body.symbol : ''
  const direction = String(body.direction ?? '').toLowerCase()
  const eventType = String(body.event_type ?? 'open').toLowerCase()

  if (!accountId || !symbol) {
    return NextResponse.json({ detail: 'account and symbol are required' }, { status: 400 })
  }
  // The DB has CHECK constraints on both columns; rejecting here gives the
  // addon a clear 400 instead of an opaque constraint violation.
  if (!DIRECTIONS.has(direction)) {
    return NextResponse.json({ detail: `direction must be one of ${[...DIRECTIONS].join(', ')}` }, { status: 400 })
  }
  if (!EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ detail: `event_type must be one of ${[...EVENT_TYPES].join(', ')}` }, { status: 400 })
  }

  // Simulated/backtest accounts never reach the dashboard, so don't toast them.
  if (accountId.toLowerCase().startsWith('sim')) {
    return NextResponse.json({ status: 'ignored', reason: 'sim account' })
  }

  const quantity = Number.isFinite(Number(body.quantity)) ? Math.trunc(Number(body.quantity)) : 1
  const totalAccounts = Number.isFinite(Number(body.total_accounts))
    ? Math.max(1, Math.trunc(Number(body.total_accounts)))
    : 1
  // pnl is only meaningful on a close; leave it null otherwise so the dashboard
  // shows the fill confirmation rather than a "$0 closed" line.
  const pnl = eventType === 'close' && Number.isFinite(Number(body.pnl))
    ? Number(body.pnl)
    : null

  const supabase = createServiceClient()
  const { error } = await supabase.from('trade_events').insert({
    account_id:     accountId,
    event_type:     eventType,
    symbol,
    direction,
    quantity,
    pnl,
    total_accounts: totalAccounts,
    occurred_at:    new Date().toISOString(),
  })

  if (error) {
    // Surfaced rather than swallowed: a silent failure here looks exactly like
    // NT8 never having sent the fill.
    console.error('[trade-event] insert failed:', error.message)
    return NextResponse.json({ detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ status: 'ok' })
}
