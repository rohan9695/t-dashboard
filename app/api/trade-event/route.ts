// app/api/trade-event/route.ts
// POST a fill from the NT8 addon: writes the trade_events rows the dashboard
// toasts subscribe to.
//
// The addon sends ONE call per fill round listing every account that filled,
// not one call per account. It is the only place that knows the whole round, and
// aggregating there is what keeps a five-account fill to a single notification
// instead of five. The rows go in one-per-account so the dashboard's existing
// realtime toast keeps working unchanged.
//
// This route does NOT send the ntfy phone push anymore — nt8/AccountMonitor.cs
// (SendNtfyAsync) does, directly from the trading machine. Confirmed
// 2026-08-14: ntfy.sh rate-limits Cloudflare Workers' shared egress IPs
// regardless of authentication (a valid Bearer token from that IP still got
// HTTP 429; the same token from a normal network delivered instantly). Only
// one place may own the push — duplicating it here risks a second alert per
// fill the moment Cloudflare's IP reputation changes.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Unset means "reject everything", never a published default. The old
// fallback was a literal in this repo, so a host that forgot the variable
// accepted a key anyone could read here — middleware happened to block it
// first, but that left one layer holding a door that should not exist. The
// Deno edge functions already fail closed this way; this matches them.
const API_KEY = process.env.API_KEY ?? ''

const EVENT_TYPES = new Set(['open', 'close', 'partial'])
const DIRECTIONS  = new Set(['long', 'short', 'flat'])

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-api-key') ?? req.headers.get('X-Api-Key')
  // !API_KEY matters as much as the comparison: with both sides empty an
  // empty X-Api-Key header would compare equal and authenticate.
  if (!API_KEY || key !== API_KEY) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 })
  }

  const symbol    = typeof body.symbol === 'string' ? body.symbol : ''
  const direction = String(body.direction ?? '').toLowerCase()
  const eventType = String(body.event_type ?? 'open').toLowerCase()

  // Accepts either `accounts: [...]` (preferred) or a single `account` string.
  const rawAccounts = Array.isArray(body.accounts)
    ? body.accounts
    : (typeof body.account === 'string' ? [body.account] : [])

  const accounts = rawAccounts
    .filter((a): a is string => typeof a === 'string' && a.length > 0)
    // Simulated/backtest accounts never reach the dashboard, so don't toast them.
    .filter((a) => !a.toLowerCase().startsWith('sim'))

  if (!symbol) {
    return NextResponse.json({ detail: 'symbol is required' }, { status: 400 })
  }
  // The DB has CHECK constraints on both columns; rejecting here gives the
  // addon a clear 400 instead of an opaque constraint violation.
  if (!DIRECTIONS.has(direction)) {
    return NextResponse.json({ detail: `direction must be one of ${[...DIRECTIONS].join(', ')}` }, { status: 400 })
  }
  if (!EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ detail: `event_type must be one of ${[...EVENT_TYPES].join(', ')}` }, { status: 400 })
  }
  if (accounts.length === 0) {
    return NextResponse.json({ status: 'ignored', reason: 'no live accounts in payload' })
  }

  const filled = accounts.length
  // Default to what actually filled, so an addon that omits the field never
  // raises a false "partial" alarm.
  const expected = Number.isFinite(Number(body.total_accounts))
    ? Math.max(filled, Math.trunc(Number(body.total_accounts)))
    : filled

  const quantity = Number.isFinite(Number(body.quantity)) ? Math.trunc(Number(body.quantity)) : 1
  // pnl is only meaningful on a close; leave it null otherwise so the dashboard
  // shows the fill confirmation rather than a "$0 closed" line.
  const pnl = eventType === 'close' && Number.isFinite(Number(body.pnl))
    ? Number(body.pnl)
    : null

  const occurredAt = new Date().toISOString()
  const supabase = createServiceClient()

  // One insert for the whole round, same shape as batch-update: flat cost
  // however many accounts filled.
  const { error } = await supabase.from('trade_events').insert(
    accounts.map((accountId) => ({
      account_id:     accountId,
      event_type:     eventType,
      symbol,
      direction,
      quantity,
      pnl,
      total_accounts: expected,
      occurred_at:    occurredAt,
    })),
  )

  if (error) {
    // Surfaced rather than swallowed: a silent failure here looks exactly like
    // NT8 never having sent the fill.
    console.error('[trade-event] insert failed:', error.message)
    return NextResponse.json({ detail: error.message }, { status: 500 })
  }

  const partial = filled < expected

  return NextResponse.json({ status: 'ok', accounts: filled, expected, partial })
}
