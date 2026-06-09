// app/api/killswitch/route.ts
// POST /api/killswitch — activate killswitch (requires KILLSWITCH_TOKEN)
// GET  /api/killswitch  — alias for /api/killswitch/status

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'edge'

const KILLSWITCH_TOKEN = process.env.KILLSWITCH_TOKEN ?? ''
const ALERT_EMAIL      = process.env.ALERT_EMAIL ?? ''
const RESEND_API_KEY   = process.env.RESEND_API_KEY ?? ''

function checkToken(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${KILLSWITCH_TOKEN}` && KILLSWITCH_TOKEN !== ''
}

export async function POST(req: NextRequest) {
  if (!checkToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'killswitch', value: 'true', updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Alert email via Resend REST API (no SDK — edge runtime compat)
  if (RESEND_API_KEY && ALERT_EMAIL) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'alerts@resend.dev',
        to: ALERT_EMAIL,
        subject: '🚨 Trader Dashboard KILLSWITCH ACTIVATED',
        html: `<p>The killswitch was activated.</p>
               <p>Time: ${new Date().toISOString()}</p>
               <p>IP: ${ip}</p>
               <p>All API endpoints now return 503.</p>`,
      }),
    }).catch(() => { /* non-critical */ })
  }

  return NextResponse.json({ activated: true, ts: new Date().toISOString(), ip })
}

// GET is a convenience alias for /api/killswitch/status
export async function GET() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'killswitch')
    .single()
  const active = data?.value === 'true'
  return NextResponse.json({ killswitch: active })
}
