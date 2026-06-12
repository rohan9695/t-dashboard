// app/api/heartbeat/route.ts
// Ping endpoint used by the Supabase keep-warm function and the NT8 heartbeat monitor.
// Returns 200 + timestamp so callers can measure latency.
import { NextResponse } from 'next/server'


export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() })
}
