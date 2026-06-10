// app/api/killswitch/reset/route.ts
// POST /api/killswitch/reset — deactivate killswitch
// Accepts either:
//   - Authorization: Bearer <KILLSWITCH_TOKEN>  (server-side / curl)
//   - td_session cookie with a valid JWT         (browser)

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyJWT } from '@/lib/jwt'
import { AUTH_JWT_SECRET } from '@/lib/auth-secret'

export const runtime = 'edge'

const KILLSWITCH_TOKEN = process.env.KILLSWITCH_TOKEN ?? ''

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // Option 1: KILLSWITCH_TOKEN Bearer header (for curl / server automation)
  const auth = req.headers.get('authorization') ?? ''
  if (KILLSWITCH_TOKEN && auth === `Bearer ${KILLSWITCH_TOKEN}`) return true

  // Option 2: valid td_session cookie (for browser — cookie sent automatically)
  const sessionCookie = req.cookies.get('td_session')?.value
  if (sessionCookie && AUTH_JWT_SECRET) {
    const payload = await verifyJWT(sessionCookie, AUTH_JWT_SECRET)
    if (payload) return true
  }

  return false
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'killswitch', value: 'false', updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deactivated: true, ts: new Date().toISOString() })
}
